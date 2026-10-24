"""
Genera las páginas estáticas de RunNear que Google puede leer e indexar (la web principal
es un mapa dibujado con JavaScript, que los buscadores apenas ven):

  carrera/<slug>/index.html                  una página por carrera, con datos estructurados
                                             schema.org/SportsEvent (resultados destacados)
  calendario/index.html                      calendario de toda España por comunidades
  calendario/<comunidad>/index.html          carreras de la comunidad, por meses
  calendario/<comunidad>/<provincia>/        carreras de la provincia, por meses
  guias/, guias/<slug>/                      guías para corredores (texto en sitio/guias/)
  sitemap.xml, robots.txt                    para los buscadores

Se genera en cada publicación (GitHub Actions) a partir de carreras.json y NO se guarda en
el repositorio (.gitignore). Todos los enlaces son relativos, así que funciona en cualquier
dirección: si cambiara, basta con tocar SITIO_URL (enlaces canónicos y sitemap) y las demás
apariciones que señala tests/test_sitio.py.

Uso (desde la carpeta del proyecto):
    py -m sitio.generar
"""

import functools
import hashlib
import json
import math
import os
import re
import shutil
import sys
from collections import defaultdict
from datetime import date, timedelta

from sitio.formato import (DIAS, MESES, dia_y_mes, distancias_texto, e, enumerar, fecha_larga, km_texto,
                           lista_km, precio_texto, slug, tipo_texto, url_segura)
from sitio import historial, textos
from sitio.guias import (GUIAS, GUIA_SAN_SILVESTRE, GUIAS_DE_CALENDARIO, GUIAS_GENERALES, GUIAS_LARGAS,
                         GUIAS_TRAIL, TEMAS)

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITIO_URL = "https://gorunnear.com/"   # dirección pública de la web (también en mapa.html)
# Cuenta de Google AdSense (la misma en mapa.html, legal.html y ads.txt; lo comprueba tests/test_sitio.py)
ADSENSE_CUENTA = "ca-pub-6802213588582157"
SALIDAS = ["carrera", "calendario", "guias", "sobre-runnear", "contacto", "cookies"]  # carpetas generadas (se borran y rehacen)

# Páginas informativas (texto en sitio/paginas/<slug>.html; marcas {{R}}, {{N_CARRERAS}}, {{N_GUIAS}}).
# Al cambiar el texto de una, actualizar su fecha.
PAGINAS_FIJAS = [
    {"slug": "sobre-runnear", "titulo": "Sobre RunNear", "fecha": "2026-10-12",
     "titulo_seo": "Sobre RunNear: qué es, de dónde salen los datos y cómo se mantiene",
     "descripcion": "RunNear reúne las carreras populares y de trail de España en un mapa y un calendario. "
                    "Qué ofrece, de dónde salen sus datos, cómo se actualiza y cómo se mantiene."},
    {"slug": "contacto", "titulo": "Contacto", "fecha": "2026-10-12",
     "titulo_seo": "Contacto: correcciones, organizadores y sugerencias",
     "descripcion": "Escribe a RunNear para corregir los datos de una carrera, si organizas una, por "
                    "privacidad o para enviar sugerencias."},
    {"slug": "cookies", "titulo": "Política de cookies", "fecha": "2026-10-12",
     "titulo_seo": "Política de cookies",
     "descripcion": "Qué guarda RunNear en tu navegador, para qué sirve, qué ocurrirá con la publicidad y "
                    "cómo borrar o bloquear estos datos."},
]

COMUNIDAD_DE = {}  # provincia -> comunidad (se rellena con scraper.comun)


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

ROMANOS = re.compile(r"\b(?=[ivxlcdm]+\b)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})\b")


def slug_evento(c):
    """Dirección estable entre ediciones: nombre sin año ni número de edición + pueblo
    ("XXI Carrera de Tomelloso 2026" -> carrera-de-tomelloso-tomelloso)."""
    t = slug(c["nombre"]).replace("-", " ")
    t = re.sub(r"\b(19|20)\d{2}\b", " ", t)
    t = re.sub(rf"\b{int(c['fecha'][2:4]):02d}\s*$", " ", t)   # año abreviado al final ("... 26")
    t = ROMANOS.sub(" ", t)
    t = re.sub(r"\b\d+\s*(a|o)\b", " ", t)
    t = re.sub(r"\b(edicion|ed)\b", " ", t)
    base = slug(t) or "carrera"
    pueblo = slug(c.get("municipio"))
    return base if pueblo and pueblo in base else f"{base}-{pueblo}"[:90].strip("-")


def haversine(a, b):
    r = math.radians
    dlat, dlng = r(b["lat"] - a["lat"]), r(b["lng"] - a["lng"])
    h = math.sin(dlat / 2) ** 2 + math.cos(r(a["lat"])) * math.cos(r(b["lat"])) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def _ultimo_domingo(anio, mes):
    d = date(anio, mes + 1, 1) - timedelta(days=1) if mes < 12 else date(anio, 12, 31)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def desfase_horario(iso, provincia):
    """'+02:00' / '+01:00' (península) o una hora menos en Canarias, según horario de verano."""
    d = date.fromisoformat(iso)
    verano = _ultimo_domingo(d.year, 3) <= d < _ultimo_domingo(d.year, 10)
    horas = (2 if verano else 1) - (1 if provincia in ("Las Palmas", "Santa Cruz de Tenerife") else 0)
    return f"+{horas:02d}:00"


def relativo(profundidad):
    return "../" * profundidad


# Política de seguridad de contenido: el navegador solo ejecuta código de la propia web y de
# Google AdSense (anuncios y aviso de cookies), y solo se conecta a los servicios que usa (cuentas,
# tiempo previsto, situar propuestas en el mapa, anuncios). Aunque alguien colara código en un
# texto, no se ejecutaría: nunca 'unsafe-inline' ni 'unsafe-eval' en script-src.
# Es la misma en todas las páginas: mapa.html y legal.html la copian (tests/test_sitio.py lo comprueba).
GOOGLE_ANUNCIOS = ("https://*.googlesyndication.com https://*.google.com https://*.gstatic.com "
                   "https://*.doubleclick.net https://*.googletagservices.com https://*.googleadservices.com "
                   "https://*.adtrafficquality.google")
CSP = ("default-src 'self'; "
       f"script-src 'self' {GOOGLE_ANUNCIOS}; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "img-src 'self' data: blob: https:; "
       "font-src 'self' https://fonts.gstatic.com; "
       "connect-src 'self' https://fndytkkukhmijrrikjyw.supabase.co https://api.open-meteo.com "
       f"https://nominatim.openstreetmap.org {GOOGLE_ANUNCIOS}; "
       f"frame-src {GOOGLE_ANUNCIOS}; "
       "worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'")


@functools.lru_cache(maxsize=None)
def recurso(ruta):
    """'css/paginas.css' -> 'css/paginas.css?v=1a2b3c4d': la huella cambia con el contenido, para que
    el navegador (y el service worker) descarguen la versión nueva en cuanto cambia el archivo."""
    with open(os.path.join(RAIZ, *ruta.split("/")), "rb") as f:
        return f"{ruta}?v={hashlib.md5(f.read()).hexdigest()[:8]}"


def hueco(tipo="horizontal"):
    """Sitio para un anuncio; anuncios.js lo rellena (o lo deja oculto si AdSense no está activo)."""
    return f'<div class="anuncio" data-tipo="{tipo}"></div>'


# ---------------------------------------------------------------------------
# Plantilla común
# ---------------------------------------------------------------------------

def pagina(titulo, descripcion, ruta, profundidad, cuerpo, migas, datos_estructurados=None, imagen=None,
           tipo_og="website", cabeza="", indexar=True):
    """ruta: dirección relativa de la página (para el enlace canónico), p. ej. 'carrera/x/'.
    migas: [(texto, ruta relativa a la raíz o None si es la página actual)]; None en la portada.
    cabeza: HTML extra para el <head>. indexar=False: Google puede leerla y seguir sus enlaces,
    pero no la mete en el buscador (y no va en el sitemap)."""
    r = relativo(profundidad)
    canonica = SITIO_URL + ruta
    migas_html = " › ".join(
        f'<a href="{r}{e(url) or "./"}">{e(texto)}</a>' if url is not None else f"<span>{e(texto)}</span>"
        for texto, url in migas or [])
    # Las migas también como datos estructurados: Google las muestra en lugar de la dirección
    lista_migas = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i, "name": texto, "item": SITIO_URL + url if url is not None else canonica}
        for i, (texto, url) in enumerate(migas, 1)]}] if migas else []
    ld = "\n".join(f'<script type="application/ld+json">{json.dumps(d, ensure_ascii=False).replace("</", "<" + chr(92) + "/")}</script>'
                   for d in (datos_estructurados or []) + lista_migas)
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="google-adsense-account" content="{ADSENSE_CUENTA}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
{'' if indexar else '<meta name="robots" content="noindex, follow">'}
<title>{e(titulo)}</title>
<meta name="description" content="{e(descripcion)}">
<link rel="canonical" href="{e(canonica)}">
<meta property="og:type" content="{tipo_og}">
<meta property="og:site_name" content="RunNear">
<meta property="og:locale" content="es_ES">
<meta property="og:url" content="{e(canonica)}">
<meta property="og:title" content="{e(titulo)}">
<meta property="og:description" content="{e(descripcion)}">
<meta property="og:image" content="{e(imagen or SITIO_URL + 'iconos/compartir.jpg')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0c1220" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f6f8fc" media="(prefers-color-scheme: light)">
<script src="{r}{recurso('js/tema-paginas.js')}"></script>
<link rel="icon" type="image/png" sizes="32x32" href="{r}iconos/favicon-32.png">
<link rel="stylesheet" href="{r}vendor/fonts/fonts.css">
<link rel="stylesheet" href="{r}{recurso('css/paginas.css')}">
{cabeza}{ld}
<script src="{r}{recurso('js/anuncios.js')}" defer></script>
</head>
<body>
<header class="cabecera">
  <a class="marca" href="{r or './'}"><img src="{r}iconos/icono-192.png" alt="" width="34" height="34"><span>Run<b>Near</b></span></a>
  <nav class="nav">
    <a href="{r}calendario/"><span aria-hidden="true">📅</span><span>Calendario</span></a>
    <a href="{r}guias/"><span aria-hidden="true">💡</span><span>Guías</span></a>
    <a class="boton" href="{r}mapa.html"><span aria-hidden="true">📍</span><span>Mapa</span></a>
  </nav>
</header>
<main class="contenido">
{f'<nav class="migas" aria-label="Estás en">{migas_html}</nav>' if migas else ''}
{cuerpo}
</main>
<footer class="pie">
  <p>RunNear reúne las carreras populares y de trail de España en un mapa. Los datos se recopilan
  cada día de calendarios públicos y de las webs de cada carrera, citando siempre la fuente:
  confirma siempre fecha y condiciones en la web oficial antes de inscribirte.</p>
  <p><a href="{r or './'}">Inicio</a> · <a href="{r}mapa.html">Mapa de carreras</a> · <a href="{r}calendario/">Calendario por zonas</a> ·
  <a href="{r}guias/">Guías para corredores</a></p>
  <p><a href="{r}sobre-runnear/">Sobre RunNear</a> · <a href="{r}contacto/">Contacto</a> ·
  <a href="{r}legal.html">Privacidad y aviso legal</a> · <a href="{r}cookies/">Política de cookies</a> ·
  <a href="{r}cookies/#configurar" data-cookies>Configurar cookies</a></p>
</footer>
</body>
</html>
"""


def bloque_guias(prefijo, slugs, titulo="Guías útiles"):
    """Enlaces a guías desde fichas y calendarios (enlazado interno: ayuda a que Google las encuentre)."""
    guias = {g["slug"]: g for g in GUIAS}
    return (f'<section><h2>{e(titulo)}</h2><ul class="zonas guias-mini">' + "".join(
        f'<li><a href="{prefijo}guias/{s}/">{guias[s]["icono"]} {e(guias[s]["titulo"])}</a></li>'
        for s in slugs if s in guias) + "</ul>"
        f'<p><a href="{prefijo}guias/">Ver todas las guías para corredores →</a></p></section>')


def guias_para_carrera(c):
    """Guías recomendadas en la ficha de una carrera, según su tipo y distancia."""
    largas = any(k >= 21 for k in (c.get("distancias_km") or []))
    slugs = (([GUIA_SAN_SILVESTRE] if es_san_silvestre(c) else [])
             + (GUIAS_TRAIL if c.get("tipo") == "trail" else [])
             + (GUIAS_LARGAS if largas and c.get("tipo") != "trail" else [])
             + GUIAS_GENERALES)
    return list(dict.fromkeys(slugs))[:6]


def es_san_silvestre(c):
    return "silvestre" in c["nombre"].lower()


# ---------------------------------------------------------------------------
# Página de cada carrera
# ---------------------------------------------------------------------------

def datos_evento(c, url):
    hora = c.get("hora")
    inicio = f"{c['fecha']}T{hora}:00{desfase_horario(c['fecha'], c.get('provincia'))}" if hora else c["fecha"]
    estado = {"cancelada": "EventCancelled", "suspendida": "EventCancelled",
              "aplazada": "EventPostponed"}.get(c.get("estado"), "EventScheduled")
    lugar = {"@type": "Place", "name": c.get("municipio"),
             "address": {"@type": "PostalAddress", "addressLocality": c.get("municipio"),
                         "addressRegion": c.get("provincia"), "addressCountry": "ES"}}
    if c.get("ubicacion"):
        lugar["geo"] = {"@type": "GeoCoordinates", "latitude": c["ubicacion"]["lat"], "longitude": c["ubicacion"]["lng"]}
    web_oficial = url_segura(c.get("url_oficial")) or url
    datos = {
        "@context": "https://schema.org", "@type": "SportsEvent", "name": c["nombre"],
        # Las carreras populares duran unas horas: empiezan y terminan el mismo día
        "startDate": inicio, "endDate": c["fecha"], "eventStatus": f"https://schema.org/{estado}",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "location": lugar, "url": url, "sport": "Atletismo",
        "description": descripcion_carrera(c),
        "image": [SITIO_URL + "iconos/compartir.jpg"],
        # No sabemos el nombre exacto de la entidad organizadora: se identifica por la carrera y su web
        "organizer": {"@type": "Organization", "name": c.get("organizador") or c["nombre"], "url": web_oficial},
        "performer": {"@type": "PerformingGroup", "name": f"Corredores de {c['nombre']}"},
    }
    if c.get("precio_desde") is not None:
        # validFrom: el día en que vimos publicado ese precio en su web de inscripción
        datos["offers"] = {"@type": "Offer", "price": c["precio_desde"], "priceCurrency": "EUR",
                           "url": web_oficial, "validFrom": c.get("actualizado") or date.today().isoformat()}
        if estado == "EventScheduled" and c["fecha"] >= date.today().isoformat():
            datos["offers"]["availability"] = "https://schema.org/InStock"
    return datos


def descripcion_carrera(c):
    partes = [f"{c['nombre']}: {'trail' if c.get('tipo') == 'trail' else 'carrera popular'} el "
              f"{fecha_larga(c['fecha'])} en {c.get('municipio')} ({c.get('provincia')})."]
    partes.append(f"Distancias: {distancias_texto(c)}.")
    if c.get("hora"):
        partes.append(f"Salida a las {c['hora']}.")
    if c.get("precio_desde") is not None:
        partes.append(f"Inscripción desde {precio_texto(c['precio_desde'])}.")
    return " ".join(partes)


def enlaces_de_resultados(c):
    """[(texto, url)] de las clasificaciones de una carrera (sin repetir textos)."""
    enlaces = [(r.get("texto") or "Resultados", url_segura(r["url"])) for r in c.get("resultados") or []
               if isinstance(r, dict) and url_segura(r.get("url"))]
    repetidos = {t for t, _ in enlaces if sum(1 for x, _ in enlaces if x == t) > 1}
    enlaces = [(f"{t} · {u.rstrip('/').rsplit('/', 1)[-1]}" if t in repetidos else t, u) for t, u in enlaces]
    if url_segura(c.get("resultados_web")):
        enlaces.append(("Todas las clasificaciones", url_segura(c["resultados_web"])))
    return enlaces


def pagina_carrera(c, ruta, contexto):
    """Ficha de una carrera. contexto: cercanas, misma_provincia, url_provincia, migas_zona, finde
    (otras carreras ese fin de semana en la comunidad), n_provincia, mes_ruta, anterior (edición
    anterior guardada en el archivo) y archivada (carrera pasada que ya no está en carreras.json).
    Devuelve (html, indexar)."""
    url = SITIO_URL + ruta
    hoy = date.today().isoformat()
    celebrada = c["fecha"] < hoy
    archivada = contexto.get("archivada", False)
    filas = [("📅 Fecha", fecha_larga(c["fecha"]).capitalize())]
    if c.get("hora"):
        filas.append(("🕘 Salida", c["hora"]))
    filas += [("📍 Lugar", f"{c.get('municipio')} ({c.get('provincia')}, {c.get('comunidad') or ''})".replace(", )", ")")),
              ("🏃 Tipo", tipo_texto(c)), ("📏 Distancias", distancias_texto(c))]
    if c.get("tipo") == "trail" and c.get("desnivel_positivo_m"):
        filas.append(("⛰️ Desnivel positivo", f"+{c['desnivel_positivo_m']} m"))
    if c.get("precio_desde") is not None:
        filas.append(("💶 Inscripción", f"desde {precio_texto(c['precio_desde'])}"))
    if c.get("inscritos"):
        filas.append(("👥 Inscritos", f"{c['inscritos']:,}".replace(",", ".")))
    elif c.get("plazas_max"):
        filas.append(("👥 Plazas", f"hasta {c['plazas_max']:,}".replace(",", ".")))
    if c.get("circuito"):
        filas.append(("🏆 Circuito", c["circuito"]))

    aviso = ""
    if c.get("estado"):
        aviso = f'<p class="aviso">⚠️ Según su web de inscripción, esta carrera está <b>{e(c["estado"])}</b>.</p>'
    elif archivada:
        aviso = (f'<p class="aviso">🏅 Esta carrera se celebró el {e(fecha_larga(c["fecha"]))}. Aún no conocemos la '
                 "fecha de la próxima edición: cuando se publique, la verás en esta misma página.</p>")
    elif celebrada:
        aviso = '<p class="aviso">🏅 Esta carrera ya se ha celebrado. Consulta los resultados en su web oficial.</p>'

    enlaces = enlaces_de_resultados(c) if celebrada else []
    bloque_resultados = ("<h2>Resultados</h2><ul>" + "".join(
        f'<li><a href="{e(u)}" rel="nofollow noopener" target="_blank">{e(t)} ↗</a></li>' for t, u in enlaces)
        + "</ul>") if enlaces else ""

    anterior = contexto.get("anterior")
    bloque_anterior = ""
    if anterior:
        enlaces_ant = enlaces_de_resultados(anterior)
        bloque_anterior = (f"<h2>Edición anterior</h2><p>La edición de {e(anterior['fecha'][:4])} se celebró el "
                           f"{e(fecha_larga(anterior['fecha']))}"
                           + (f" con {e(distancias_texto(anterior))}" if lista_km(anterior) else "") + ".</p>"
                           + ("<ul>" + "".join(f'<li><a href="{e(u)}" rel="nofollow noopener" target="_blank">'
                                               f"Resultados {e(anterior['fecha'][:4])}: {e(t)} ↗</a></li>"
                                               for t, u in enlaces_ant) + "</ul>" if enlaces_ant else ""))

    fuentes = c.get("fuentes") or [c.get("fuente", {}).get("nombre")]
    origen = ("Datos facilitados por la organización de la carrera." if c.get("verificada_organizador")
              else f"Datos recopilados de {e(', '.join(f for f in fuentes if f))}.")

    parrafos = textos.parrafos_carrera(c, hoy, contexto.get("n_provincia", 0), len(contexto.get("finde", [])),
                                       contexto.get("mes_ruta"))
    if c.get("descripcion"):
        parrafos.append(e(c["descripcion"]))
    preguntas = textos.preguntas_carrera(c, hoy)

    def lista(carreras, con_distancia=False):
        return "<ul class=\"lista-carreras\">" + "".join(
            f'<li><a href="../{e(r)}/">{e(x["nombre"])}</a> <span>{e(fecha_larga(x["fecha"]))} · '
            f'{e(x.get("municipio"))}{(f" · a {d:.0f} km" if d >= 1 else " · en la misma localidad") if con_distancia else ""}</span></li>'
            for x, r, d in carreras) + "</ul>"

    cercanas, misma, finde = contexto.get("cercanas", []), contexto.get("misma_provincia", []), contexto.get("finde", [])
    mapa = "../../mapa.html" if archivada else f"../../mapa.html?carrera={e(c['id'])}"
    cuerpo = f"""
<article class="carrera">
  <p class="etiqueta {'trail' if c.get('tipo') == 'trail' else 'asfalto'}">{'⛰️ Trail' if c.get('tipo') == 'trail' else '🏃 Asfalto'}</p>
  <h1>{e(c['nombre'])}</h1>
  <p class="resumen">{e(descripcion_carrera(c))}</p>
  {aviso}
  <dl class="datos">{''.join(f'<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in filas)}</dl>
  <p class="acciones">
    <a class="boton principal" href="{e(url_segura(c.get('url_oficial')) or '#')}" rel="noopener" target="_blank">{'Ver en la web oficial' if celebrada else 'Inscripción en la web oficial'} ↗</a>
    <a class="boton" href="{mapa}">📍 {'Carreras en el mapa' if archivada else 'Ver en el mapa'}</a>
  </p>
  {bloque_resultados}
  <h2>Sobre la carrera</h2>
  {''.join(f'<p>{p}</p>' for p in parrafos)}
  {bloque_anterior}
  <section class="faq"><h2>Preguntas frecuentes</h2>{''.join(f'<details><summary>{p}</summary><p>{r}</p></details>' for p, r in preguntas)}</section>
  <p class="origen">{origen} Confirma fecha, horario y condiciones en la web oficial antes de inscribirte.</p>
</article>
{hueco()}
{f'<section><h2>Ese mismo fin de semana en {e(c.get("comunidad"))}</h2>{lista(finde)}</section>' if finde else ''}
{f'<section><h2>Carreras cerca</h2>{lista(cercanas, True)}</section>' if cercanas else ''}
{f'<section><h2>Más carreras en {e(c.get("provincia"))}</h2>{lista(misma)}<p><a href="../../{e(contexto["url_provincia"])}">Ver todo el calendario de {e(c.get("provincia"))} →</a></p></section>' if misma else ''}
{hueco() if cercanas or misma or finde else ''}
{bloque_guias("../../", guias_para_carrera(c))}
"""
    # Se indexa si tiene datos suficientes; una carrera pasada, solo si enlaza a sus resultados
    indexar = not textos.es_pobre(c) and (not archivada or bool(enlaces))
    titulo = contexto.get("titulo") or textos.titulo_ficha(c, hoy)
    migas = [("RunNear", ""), ("Calendario", "calendario/")] + contexto.get("migas_zona", []) + [(c["nombre"], None)]
    return pagina(titulo, descripcion_carrera(c)[:300], ruta, 2, cuerpo, migas, [datos_evento(c, url)],
                  indexar=indexar), indexar


# ---------------------------------------------------------------------------
# Calendarios por zona
# ---------------------------------------------------------------------------

def tabla_por_meses(carreras, rutas, prefijo):
    por_mes = defaultdict(list)
    for c in sorted(carreras, key=lambda x: (x["fecha"], x["nombre"])):
        por_mes[c["fecha"][:7]].append(c)
    bloques = []
    for n, (mes, lista) in enumerate(por_mes.items()):
        if n and n % 2 == 0:
            bloques.append(hueco())   # un anuncio cada dos meses de calendario
        anio, m = mes.split("-")
        filas = "".join(
            f'<tr><td class="f">{date.fromisoformat(c["fecha"]).day} {MESES[int(m) - 1][:3]}</td>'
            f'<td><a href="{prefijo}{e(rutas[c["id"]])}">{e(c["nombre"])}</a>'
            f'<span class="sub">{e(c.get("municipio"))} · {e(distancias_texto(c))}</span></td>'
            f'<td class="t">{"⛰️" if c.get("tipo") == "trail" else "🏃"}</td></tr>'
            for c in lista)
        bloques.append(f'<h2>{MESES[int(m) - 1].capitalize()} {anio} <small>({len(lista)})</small></h2>'
                       f'<table class="calendario"><tbody>{filas}</tbody></table>')
    return "".join(bloques)


def resumen_zona(nombre, carreras, articulo="en"):
    n = len(carreras)
    trail = sum(1 for c in carreras if c.get("tipo") == "trail")
    pueblos = len({c.get("municipio") for c in carreras})
    largas = sum(1 for c in carreras if any(k >= 21 for k in (c.get("distancias_km") or [])))
    return (f"Hay {n} carreras próximas {articulo} {nombre}: {n - trail} de asfalto y {trail} de trail, "
            f"en {pueblos} {'pueblos y ciudades' if pueblos != 1 else 'localidad'}"
            f"{f', {largas} de ellas con media maratón o más' if largas else ''}. "
            "Puedes verlas también en el mapa, con la distancia a la que te quedan.")


def calcular_rutas(carreras):
    """{id: 'carrera/<slug>/'}: dirección de cada carrera, estable entre ediciones (sin año ni número
    de edición); si dos coinciden, la segunda lleva además la fecha."""
    rutas, usadas = {}, set()
    for c in sorted(carreras, key=lambda x: (x["fecha"], x["id"])):
        s = slug_evento(c)
        if s in usadas:
            s = f"{s}-{c['fecha']}"
        usadas.add(s)
        rutas[c["id"]] = f"carrera/{s}/"
    return rutas


def fin_de_semana(iso):
    """Clave del fin de semana de una fecha: el sábado si cae en sábado o domingo; si no, el propio día."""
    d = date.fromisoformat(iso)
    return (d - timedelta(days=d.weekday() - 5)).isoformat() if d.weekday() >= 5 else iso


def ruta_mes(mes):
    """'2026-11' -> 'calendario/noviembre-2026/'"""
    anio, m = mes.split("-")
    return f"calendario/{MESES[int(m) - 1]}-{anio}/"


def generar():
    sys.path.insert(0, RAIZ)
    from scraper.comun import PROVINCIAS
    COMUNIDAD_DE.update({p: c for p, (c, _) in PROVINCIAS.items()})

    with open(os.path.join(RAIZ, "carreras.json"), encoding="utf-8") as f:
        carreras = json.load(f)
    hoy = date.today().isoformat()
    for c in carreras:
        c["comunidad"] = c.get("comunidad") or COMUNIDAD_DE.get(c.get("provincia"))
    carreras = [c for c in carreras if c.get("fecha") and c.get("nombre") and c.get("provincia") and c.get("comunidad")]

    for carpeta in SALIDAS:
        destino = os.path.join(RAIZ, carpeta)
        if os.path.exists(destino):
            shutil.rmtree(destino)

    rutas = calcular_rutas(carreras)

    # Carreras pasadas que ya no están en carreras.json: su ficha sigue publicada
    archivo = historial.actualizar_archivo(historial.cargar_archivo(), carreras, rutas, hoy)
    rutas_actuales = set(rutas.values())
    archivadas = [(r, c) for r, c in sorted(archivo.items())
                  if r not in rutas_actuales and c.get("provincia") in COMUNIDAD_DE]
    fechas = historial.Fechas(hoy)

    futuras = [c for c in carreras if c["fecha"] >= hoy]
    por_provincia, por_comunidad = defaultdict(list), defaultdict(list)
    por_finde = defaultdict(list)          # (comunidad, fin de semana) -> carreras
    for c in futuras:
        por_provincia[c["provincia"]].append(c)
        por_comunidad[c["comunidad"]].append(c)
        por_finde[(c["comunidad"], fin_de_semana(c["fecha"]))].append(c)
    # Páginas por mes: los meses con carreras próximas (como mucho, un año)
    meses = sorted({c["fecha"][:7] for c in futuras})[:13]
    rutas_mes = {m: ruta_mes(m) for m in meses}

    n_provincias = defaultdict(int)
    for comunidad in COMUNIDAD_DE.values():
        n_provincias[comunidad] += 1

    def ruta_provincia(p):
        """Las comunidades de una sola provincia (Madrid, Asturias…) no tienen página de
        provincia: sería una copia exacta de la de la comunidad."""
        comunidad = COMUNIDAD_DE[p]
        return f"calendario/{slug(comunidad)}/" + ("" if n_provincias[comunidad] == 1 else f"{slug(p)}/")

    def migas_zona(p):
        """Calendarios de comunidad y provincia que EXISTEN para la provincia de una carrera.
        Solo hay calendario de una zona si tiene carreras próximas: si una fuente falla y una
        provincia se queda sin ellas, sus fichas no deben enlazar a una página que no existe."""
        comunidad = COMUNIDAD_DE[p]
        if comunidad not in por_comunidad:
            return []
        zona = [(comunidad, f"calendario/{slug(comunidad)}/")]
        if n_provincias[comunidad] > 1 and p in por_provincia:
            zona.append((p, ruta_provincia(p)))
        return zona

    sitemap = []
    titulos = set()

    def titulo_unico(titulo):
        """Dos carreras con el mismo nombre, pueblo y día tendrían el mismo título: se numeran."""
        base, n = titulo, 2
        while titulo in titulos:
            titulo = base.replace(" | RunNear", f" ({n}) | RunNear")
            n += 1
        titulos.add(titulo)
        return titulo

    # 1) Carreras (las actuales y las pasadas del archivo)
    con_ubicacion = [c for c in futuras if c.get("ubicacion")]
    for c, ruta, archivada in ([(c, rutas[c["id"]], False) for c in carreras]
                               + [(c, r, True) for r, c in archivadas]):
        cercanas = []
        if c.get("ubicacion"):
            dist = sorted(((x, haversine(c["ubicacion"], x["ubicacion"])) for x in con_ubicacion if x["id"] != c["id"]),
                          key=lambda p: p[1])
            cercanas = [(x, rutas[x["id"]].split("/")[1], d) for x, d in dist[:6] if d <= 60]
        finde = [(x, rutas[x["id"]].split("/")[1], 0)
                 for x in sorted(por_finde.get((c["comunidad"], fin_de_semana(c["fecha"])), []), key=lambda x: x["fecha"])
                 if x["id"] != c["id"]][:8] if c["fecha"] >= hoy else []
        ya = {x["id"] for x, _, _ in cercanas + finde}
        misma = [(x, rutas[x["id"]].split("/")[1], 0) for x in sorted(por_provincia.get(c["provincia"], []), key=lambda x: x["fecha"])
                 if x["id"] != c["id"] and x["id"] not in ya][:8]
        previa = archivo.get(ruta)
        anterior = previa if previa and previa["id"] != c["id"] and previa["fecha"] < c["fecha"] else None
        contexto = {
            "cercanas": cercanas, "misma_provincia": misma, "finde": finde, "anterior": anterior,
            "url_provincia": ruta_provincia(c["provincia"]), "migas_zona": migas_zona(c["provincia"]),
            "n_provincia": max(0, len(por_provincia.get(c["provincia"], [])) - (1 if c["fecha"] >= hoy else 0)),
            "mes_ruta": rutas_mes.get(c["fecha"][:7]), "archivada": archivada,
            "titulo": titulo_unico(textos.titulo_ficha(c, hoy)),
        }
        contenido, indexar = pagina_carrera(c, ruta, contexto)
        escribir(ruta, contenido)
        if indexar:
            datos = {k: v for k, v in c.items() if k != "actualizado"}
            sitemap.append((SITIO_URL + ruta, fechas.fecha(ruta, historial.huella(
                VERSION_FICHAS, datos, archivada, anterior and anterior["id"]))))

    def huella_lista(lista):
        return historial.huella(VERSION_CALENDARIOS, [(c["id"], c["fecha"], c["nombre"]) for c in lista])

    # 2) Provincias
    for p, lista in por_provincia.items():
        comunidad = COMUNIDAD_DE[p]
        if n_provincias[comunidad] == 1:
            continue
        ruta = ruta_provincia(p)
        vecinas = sorted(x for x in por_provincia if COMUNIDAD_DE.get(x) == comunidad and x != p)
        cuerpo = (f"<h1>Carreras populares y trail en {e(p)}</h1>"
                  f'<p class="resumen">{e(resumen_zona("la provincia de " + p, lista))}</p>'
                  f'<p class="acciones"><a class="boton principal" href="../../../mapa.html">📍 Ver en el mapa</a></p>'
                  + tabla_por_meses(lista, rutas, "../../../") + hueco()
                  + (f"<section><h2>Otras provincias de {e(comunidad)}</h2><ul class=\"zonas\">"
                     + "".join(f'<li><a href="../{slug(x)}/">{e(x)} <span>{len(por_provincia[x])}</span></a></li>' for x in vecinas)
                     + "</ul></section>" if vecinas else "")
                  + bloque_meses("../../../", rutas_mes)
                  + bloque_guias("../../../", GUIAS_DE_CALENDARIO, "Guías para preparar tu carrera"))
        titulo = f"Carreras populares y trail en {p} {date.today().year} · Calendario | RunNear"
        desc = f"Calendario de carreras populares y trail en {p}: {len(lista)} próximas carreras con fecha, distancias, precio e inscripción."
        migas = [("RunNear", ""), ("Calendario", "calendario/"), (comunidad, f"calendario/{slug(comunidad)}/"), (p, None)]
        escribir(ruta, pagina(titulo, desc, ruta, 3, cuerpo, migas))
        sitemap.append((SITIO_URL + ruta, fechas.fecha(ruta, huella_lista(lista))))

    # 3) Comunidades
    for comunidad, lista in por_comunidad.items():
        ruta = f"calendario/{slug(comunidad)}/"
        provincias = sorted({c["provincia"] for c in lista})
        zonas = ""
        if len(provincias) > 1:
            zonas = ("<ul class=\"zonas\">" + "".join(
                f'<li><a href="{slug(p)}/">{e(p)} <span>{len(por_provincia[p])}</span></a></li>' for p in provincias) + "</ul>")
        cuerpo = (f"<h1>Carreras populares y trail en {e(comunidad)}</h1>"
                  f'<p class="resumen">{e(resumen_zona(comunidad, lista))}</p>{zonas}'
                  f'<p class="acciones"><a class="boton principal" href="../../mapa.html">📍 Ver en el mapa</a></p>'
                  + tabla_por_meses(lista, rutas, "../../") + hueco()
                  + bloque_meses("../../", rutas_mes)
                  + bloque_guias("../../", GUIAS_DE_CALENDARIO, "Guías para preparar tu carrera"))
        titulo = f"Carreras populares y trail en {comunidad} {date.today().year} · Calendario | RunNear"
        desc = f"Calendario de carreras en {comunidad}: {len(lista)} próximas carreras populares y de trail por provincias, con fechas y distancias."
        escribir(ruta, pagina(titulo, desc, ruta, 2, cuerpo, [("RunNear", ""), ("Calendario", "calendario/"), (comunidad, None)]))
        sitemap.append((SITIO_URL + ruta, fechas.fecha(ruta, huella_lista(lista))))

    # 4) Por fechas: este fin de semana y cada mes
    sitemap += generar_fechas(futuras, rutas, rutas_mes, fechas, huella_lista)

    # 5) España
    comunidades = sorted(por_comunidad, key=lambda x: x)
    cuerpo = ("<h1>Calendario de carreras populares y trail en España</h1>"
              f'<p class="resumen">{e(resumen_zona("España", futuras, "en toda"))}</p>'
              "<h2>Por comunidades</h2><ul class=\"zonas grande\">"
              + "".join(f'<li><a href="{slug(x)}/">{e(x)} <span>{len(por_comunidad[x])}</span></a></li>' for x in comunidades)
              + "</ul>"
              + bloque_meses("../", rutas_mes, fin_de_semana_tambien=True)
              + "<h2>Próximas carreras</h2>"
              + tabla_por_meses(sorted(futuras, key=lambda x: x["fecha"])[:40], rutas, "../")
              + '<p class="acciones"><a class="boton principal" href="../mapa.html">📍 Ver todas en el mapa</a></p>'
              + hueco()
              + bloque_guias("../", GUIAS_DE_CALENDARIO, "Guías para corredores"))
    escribir("calendario/", pagina(
        f"Calendario de carreras populares y trail en España {date.today().year} | RunNear",
        f"Calendario de {len(futuras)} carreras populares y de trail en España por comunidades, provincias y meses, con fechas, distancias y enlace a la inscripción.",
        "calendario/", 1, cuerpo, [("RunNear", ""), ("Calendario", None)]))
    sitemap.insert(0, (SITIO_URL + "calendario/", fechas.fecha("calendario/", huella_lista(futuras))))

    # 6) Guías
    sitemap += generar_guias(futuras, rutas)

    # 7) Portada (lo primero que se ve al entrar en la web) y páginas informativas
    generar_portada(futuras, rutas, por_comunidad, rutas_mes)
    sitemap += generar_paginas_fijas(len(futuras))
    sitemap = [(SITIO_URL, hoy), (SITIO_URL + "mapa.html", hoy), (SITIO_URL + "legal.html", "2026-10-13")] + sitemap

    # 8) Lista de provincias para la web (una sola fuente: scraper/comun.py)
    escribir_provincias_js()

    # 9) Memoria para la próxima vez: carreras pasadas y fechas reales de cambio
    historial.guardar_archivo(archivo)
    fechas.guardar()

    # 10) Para los buscadores
    with open(os.path.join(RAIZ, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for url, fecha in sitemap:
            f.write(f"  <url><loc>{e(url)}</loc><lastmod>{fecha}</lastmod></url>\n")
        f.write("</urlset>\n")
    with open(os.path.join(RAIZ, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(f"User-agent: *\nAllow: /\n\nSitemap: {SITIO_URL}sitemap.xml\n")

    n_fichas = len(carreras) + len(archivadas)
    n_indexadas = sum(1 for u, _ in sitemap if "/carrera/" in u)
    print(f"OK: {n_fichas} fichas de carreras ({len(archivadas)} ya pasadas del archivo; {n_indexadas} indexables), "
          f"{sum(1 for p in por_provincia if n_provincias[COMUNIDAD_DE[p]] > 1)} provincias, "
          f"{len(por_comunidad)} comunidades, {len(rutas_mes)} meses, {len(GUIAS)} guías; sitemap: {len(sitemap)} direcciones")


# Si cambia la plantilla de las fichas o de los calendarios, subir el número: su fecha en el
# sitemap pasa a hoy (el contenido ha cambiado de verdad)
VERSION_FICHAS = 2
VERSION_CALENDARIOS = 2


def bloque_meses(prefijo, rutas_mes, fin_de_semana_tambien=False):
    """Enlaces a las páginas por fecha (meses y, opcionalmente, este fin de semana)."""
    enlaces = ([f'<li><a href="{prefijo}calendario/fin-de-semana/">Este fin de semana</a></li>']
               if fin_de_semana_tambien else [])
    enlaces += [f'<li><a href="{prefijo}{r}">{MESES[int(m[5:]) - 1].capitalize()} {m[:4]}</a></li>'
                for m, r in rutas_mes.items()]
    return f'<section><h2>Carreras por fechas</h2><ul class="zonas">{"".join(enlaces)}</ul></section>' if enlaces else ""


def tabla_por_comunidades(carreras, rutas, prefijo, con_dia_semana=False):
    """Carreras agrupadas por comunidad (para las páginas por fecha), con un anuncio cada 3 comunidades."""
    grupos = defaultdict(list)
    for c in sorted(carreras, key=lambda x: (x["fecha"], x["nombre"])):
        grupos[c["comunidad"]].append(c)
    bloques = []
    for n, (comunidad, lista) in enumerate(sorted(grupos.items(), key=lambda g: (-len(g[1]), g[0]))):
        if n and n % 3 == 0:
            bloques.append(hueco())
        filas = "".join(
            f'<tr><td class="f">{(DIAS[date.fromisoformat(c["fecha"]).weekday()][:3] + " ") if con_dia_semana else ""}'
            f'{date.fromisoformat(c["fecha"]).day} {MESES[int(c["fecha"][5:7]) - 1][:3]}</td>'
            f'<td><a href="{prefijo}{e(rutas[c["id"]])}">{e(c["nombre"])}</a>'
            f'<span class="sub">{e(c.get("municipio"))} ({e(c.get("provincia"))}) · {e(distancias_texto(c))}</span></td>'
            f'<td class="t">{"⛰️" if c.get("tipo") == "trail" else "🏃"}</td></tr>'
            for c in lista)
        bloques.append(f'<h2 id="{slug(comunidad)}">{e(comunidad)} <small>({len(lista)})</small></h2>'
                       f'<table class="calendario"><tbody>{filas}</tbody></table>')
    return "".join(bloques)


def generar_fechas(futuras, rutas, rutas_mes, fechas, huella_lista):
    """calendario/fin-de-semana/ y calendario/<mes>-<año>/: lo que la gente busca por fecha
    ("carreras este fin de semana", "carreras 22 de noviembre"). Devuelve sus entradas del sitemap."""
    entradas = []
    hoy = date.today()
    sabado = hoy + timedelta(days=(5 - hoy.weekday()) % 7) if hoy.weekday() != 6 else hoy - timedelta(days=1)
    domingo = sabado + timedelta(days=1)
    finde = [c for c in futuras if sabado.isoformat() <= c["fecha"] <= domingo.isoformat()]
    trail = sum(1 for c in finde if c.get("tipo") == "trail")
    dias = (f"{sabado.day} y {domingo.day} de {MESES[domingo.month - 1]}" if sabado.month == domingo.month
            else f"{dia_y_mes(sabado.isoformat())} y {dia_y_mes(domingo.isoformat())}")
    ruta = "calendario/fin-de-semana/"
    cuerpo = (f"<h1>Carreras este fin de semana en España</h1>"
              f'<p class="resumen">El sábado y el domingo ({dias}) se corren {len(finde)} carreras populares y de '
              f"trail en España: {len(finde) - trail} de asfalto y {trail} de montaña. Aquí las tienes todas por "
              "comunidades, con su distancia y el enlace a cada una. Se actualiza cada día.</p>"
              '<p class="acciones"><a class="boton principal" href="../../mapa.html">📍 Ver las que tienes cerca en el mapa</a></p>'
              + (tabla_por_comunidades(finde, rutas, "../../", con_dia_semana=True)
                 or "<p>Todavía no hay carreras publicadas para este fin de semana.</p>")
              + hueco() + bloque_meses("../../", rutas_mes)
              + bloque_guias("../../", ["dia-de-la-carrera", "calculadora-ritmo", "ropa-para-correr"],
                             "Prepara tu carrera"))
    escribir(ruta, pagina(f"Carreras este fin de semana ({dias}) en España | RunNear",
                          f"Las {len(finde)} carreras populares y de trail de este fin de semana ({dias}) en España, "
                          "por comunidades, con distancias e inscripción.",
                          ruta, 2, cuerpo, [("RunNear", ""), ("Calendario", "calendario/"), ("Este fin de semana", None)]))
    entradas.append((SITIO_URL + ruta, fechas.fecha(ruta, huella_lista(finde))))

    lista_meses = list(rutas_mes.items())
    for i, (mes, ruta) in enumerate(lista_meses):
        anio, m = mes.split("-")
        nombre_mes = MESES[int(m) - 1]
        delmes = [c for c in futuras if c["fecha"][:7] == mes]
        trail = sum(1 for c in delmes if c.get("tipo") == "trail")
        comunidades = defaultdict(int)
        for c in delmes:
            comunidades[c["comunidad"]] += 1
        top = [f"{x} ({n})" for x, n in sorted(comunidades.items(), key=lambda x: -x[1])[:3]]
        navegacion = ""
        if i:
            navegacion += f'<a href="../{lista_meses[i - 1][1].split("/")[1]}/">← {MESES[int(lista_meses[i - 1][0][5:]) - 1].capitalize()}</a> '
        if i + 1 < len(lista_meses):
            navegacion += f'<a href="../{lista_meses[i + 1][1].split("/")[1]}/">{MESES[int(lista_meses[i + 1][0][5:]) - 1].capitalize()} →</a>'
        cuerpo = (f"<h1>Carreras populares y trail en {nombre_mes} de {anio}</h1>"
                  f'<p class="resumen">En {nombre_mes} de {anio} hay {len(delmes)} carreras '
                  f"{'próximas ' if mes == hoy.isoformat()[:7] else ''}en España: {len(delmes) - trail} de asfalto y "
                  f"{trail} de trail. Las comunidades con más carreras son {enumerar(top)}. Aquí las tienes todas "
                  "por comunidades y días.</p>"
                  + (f'<p class="acciones">{navegacion}</p>' if navegacion else "")
                  + tabla_por_comunidades(delmes, rutas, "../../")
                  + hueco() + bloque_meses("../../", rutas_mes, fin_de_semana_tambien=True)
                  + bloque_guias("../../", GUIAS_DE_CALENDARIO, "Guías para preparar tu carrera"))
        escribir(ruta, pagina(f"Carreras populares en {nombre_mes} de {anio}: calendario de España | RunNear",
                              f"Calendario de las {len(delmes)} carreras populares y de trail de {nombre_mes} de {anio} "
                              "en España, por comunidades y días, con distancias e inscripción.",
                              ruta, 2, cuerpo,
                              [("RunNear", ""), ("Calendario", "calendario/"), (f"{nombre_mes.capitalize()} {anio}", None)]))
        entradas.append((SITIO_URL + ruta, fechas.fecha(ruta, huella_lista(delmes))))
    return entradas


# ---------------------------------------------------------------------------
# Portada (index.html): elegir entre mapa, calendario y guías
# ---------------------------------------------------------------------------

GUIAS_PORTADA = ["empezar-a-correr", "primera-carrera-5-km", "plan-10k", "calculadora-ritmo",
                 "iniciarse-en-el-trail", "alimentacion-para-corredores"]


def generar_portada(futuras, rutas, por_comunidad, rutas_mes):
    hoy = date.today()
    sabado = hoy + timedelta(days=(5 - hoy.weekday()) % 7) if hoy.weekday() != 6 else hoy - timedelta(days=1)
    finde = sorted((c for c in futuras if sabado.isoformat() <= c["fecha"] <= (sabado + timedelta(days=1)).isoformat()),
                   key=lambda c: (c["fecha"], c["nombre"]))
    trail = sum(1 for c in futuras if c.get("tipo") == "trail")
    por_slug = {g["slug"]: g for g in GUIAS}
    destacadas = ([GUIA_SAN_SILVESTRE] if hoy.month in (10, 11, 12) else []) + GUIAS_PORTADA
    destacadas = destacadas[:6]

    opciones = [
        ("mapa.html", "📍", "Mapa de carreras",
         f"Las {len(futuras)} próximas carreras en el mapa: mira cuáles tienes más cerca y filtra por fecha, distancia o tipo."),
        ("calendario/", "📅", "Calendario por zonas",
         f"Todas las carreras de las {len(por_comunidad)} comunidades y sus provincias, ordenadas mes a mes."),
        ("guias/", "💡", "Guías para corredores",
         f"{len(GUIAS)} guías: empezar a correr, planes de 5K a maratón, trail, salud y una calculadora de ritmo."),
    ]
    tarjetas = "".join(
        f'<li><a href="{url}"><span class="icono">{icono}</span><b>{e(titulo)}</b><span class="sub">{e(texto)}</span>'
        f'<span class="ir">Entrar →</span></a></li>' for url, icono, titulo, texto in opciones)

    if finde:
        # 10 carreras repartidas por comunidades (primero las de más inscritos o con precio publicado)
        grupos = defaultdict(list)
        for c in sorted(finde, key=lambda c: (-(c.get("inscritos") or 0), c.get("precio_desde") is None, c["nombre"])):
            grupos[c["comunidad"]].append(c)
        elegidas = []
        while len(elegidas) < 10 and any(grupos.values()):
            for comunidad in sorted(grupos, key=lambda x: -len(grupos[x])):
                if grupos[comunidad] and len(elegidas) < 10:
                    elegidas.append(grupos[comunidad].pop(0))
        lista_finde = ('<ul class="lista-carreras">' + "".join(
            f'<li><a href="{e(rutas[c["id"]])}">{e(c["nombre"])}</a> <span>{e(fecha_larga(c["fecha"]))} · '
            f'{e(c.get("municipio"))} ({e(c.get("provincia"))}) · {e(distancias_texto(c))}</span></li>'
            for c in sorted(elegidas, key=lambda c: (c["fecha"], c["nombre"]))) + "</ul>")
        mas = f" Te mostramos 10 de las {len(finde)}." if len(finde) > 10 else ""
        bloque_finde = (f"<section><h2>Este fin de semana: {len(finde)} carreras</h2>"
                        f'<p class="resumen">Carreras del {sabado.day} y {(sabado + timedelta(days=1)).day} de '
                        f"{MESES[sabado.month - 1]} en toda España.{mas}</p>{lista_finde}"
                        '<p><a href="calendario/fin-de-semana/">Ver las ' + str(len(finde)) + ' carreras del fin de semana →</a> · '
                        '<a href="mapa.html">Las que tienes más cerca, en el mapa →</a></p></section>')
    else:
        bloque_finde = ""

    cuerpo = (
        '<section class="portada">'
        "<h1>Carreras populares y trail en toda España</h1>"
        f'<p class="resumen">{len(futuras)} próximas carreras, {len(futuras) - trail} de asfalto y {trail} de trail, '
        "recogidas cada día de los calendarios públicos. ¿Qué quieres hacer?</p>"
        f'<ul class="opciones">{tarjetas}</ul></section>'
        + hueco()
        + bloque_finde
        + "<section><h2>Carreras por comunidades</h2><ul class=\"zonas grande\">"
        + "".join(f'<li><a href="calendario/{slug(x)}/">{e(x)} <span>{len(por_comunidad[x])}</span></a></li>'
                  for x in sorted(por_comunidad)) + "</ul></section>"
        + bloque_meses("", rutas_mes, fin_de_semana_tambien=True)
        + hueco()
        + '<section><h2>Guías para corredores</h2><ul class="tarjetas-guias">' + "".join(
            f'<li><a href="guias/{s}/"><span class="icono">{por_slug[s]["icono"]}</span><b>{e(por_slug[s]["titulo"])}</b>'
            f'<span class="sub">{e(por_slug[s]["resumen"])}</span></a></li>' for s in destacadas)
        + '</ul><p><a href="guias/">Ver las ' + str(len(GUIAS)) + " guías →</a></p></section>"
        + "<section><h2>Qué es RunNear</h2>"
        "<p>RunNear reúne en un solo sitio las carreras populares y de trail de toda España: urbanas, "
        "nocturnas, solidarias, cross, San Silvestre, medias maratones, maratones y carreras por montaña. "
        "Cada día revisamos los calendarios públicos y las webs de las carreras para que encuentres la tuya "
        "sin tener que buscar en decenas de páginas, y siempre te enlazamos a la web oficial para "
        "inscribirte.</p>"
        "<p>En el mapa puedes ver las carreras más cercanas a tu ubicación y, con una cuenta gratuita, "
        "guardar tus favoritas, marcar las que ya has corrido, recibir avisos de nuevas carreras cerca de ti "
        "y dejar tu opinión. ¿Organizas una carrera que no aparece? Puedes añadirla desde el menú del mapa.</p>"
        "</section>"
    )
    datos = [
        {"@context": "https://schema.org", "@type": "WebSite", "name": "RunNear", "url": SITIO_URL,
         "inLanguage": "es-ES",
         "description": "Mapa, calendario y guías de carreras populares y de trail en España."},
        {"@context": "https://schema.org", "@type": "Organization", "name": "RunNear", "url": SITIO_URL,
         "logo": SITIO_URL + "iconos/icono-512.png"},
    ]
    escribir("", pagina(
        "RunNear | Carreras populares y trail en España: mapa, calendario y guías",
        f"Encuentra carreras populares y de trail en toda España: {len(futuras)} próximas carreras en un mapa y "
        "un calendario por provincias, con fecha, distancias e inscripción, y guías para corredores.",
        # js/portada.js: los enlaces antiguos a la raíz que son del mapa (carrera compartida, vuelta del
        # inicio de sesión, avisos al móvil) y la app instalada se llevan al mapa
        "", 0, cuerpo, None, datos, cabeza=f'<script src="{recurso("js/portada.js")}"></script>\n'))


# ---------------------------------------------------------------------------
# Páginas informativas: Sobre RunNear, Contacto, Política de cookies
# ---------------------------------------------------------------------------

def generar_paginas_fijas(n_carreras):
    """Escribe <slug>/index.html de cada página informativa; devuelve sus entradas del sitemap."""
    entradas = []
    for p in PAGINAS_FIJAS:
        with open(os.path.join(RAIZ, "sitio", "paginas", p["slug"] + ".html"), encoding="utf-8") as f:
            texto = f.read()
        for marca, valor in {"{{R}}": "../", "{{N_CARRERAS}}": str(n_carreras), "{{N_GUIAS}}": str(len(GUIAS))}.items():
            texto = texto.replace(marca, valor)
        texto, indice = con_indice(texto)
        cuerpo = (f'<article class="guia"><h1>{e(p["titulo"])}</h1>'
                  f'<p class="fecha-guia">Última actualización: {e(fecha_larga(p["fecha"]).split(", ")[1])}</p>'
                  f"{indice.replace('En esta guía', 'En esta página')}{texto}</article>")
        ruta = p["slug"] + "/"
        escribir(ruta, pagina(f'{p["titulo_seo"]} | RunNear', p["descripcion"], ruta, 1, cuerpo,
                              [("RunNear", ""), (p["titulo"], None)]))
        entradas.append((SITIO_URL + ruta, p["fecha"]))
    return entradas


# ---------------------------------------------------------------------------
# Guías (texto en sitio/guias/<slug>.html, datos en sitio/guias.py)
# ---------------------------------------------------------------------------

def tabla_ritmos():
    """Tiempo final en las distancias clásicas para ritmos de 3:30 a 8:00 min/km."""
    def t(seg):
        seg = round(seg)
        h, m, s = seg // 3600, seg % 3600 // 60, seg % 60
        return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
    distancias = [5, 10, 21.0975, 42.195]
    filas = "".join(
        f"<tr><td><b>{t(r)}</b></td><td>{60 / (r / 60):.1f}".replace(".", ",")
        + "</td>" + "".join(f"<td>{t(r * d)}</td>" for d in distancias) + "</tr>"
        for r in range(210, 481, 15))
    return ('<div class="tabla-envoltorio"><table class="tabla"><thead><tr><th>Ritmo (min/km)</th><th>km/h</th>'
            "<th>5K</th><th>10K</th><th>Media</th><th>Maratón</th></tr></thead>"
            f"<tbody>{filas}</tbody></table></div>")


def lista_san_silvestre(futuras, rutas, prefijo):
    carreras = sorted((c for c in futuras if es_san_silvestre(c)), key=lambda c: (c["comunidad"], c["fecha"]))
    if not carreras:
        return ("<p>Todavía no hay San Silvestre publicadas para este año. Los calendarios suelen ir "
                "llenándose a partir de octubre: vuelve en unos días.</p>")
    por_comunidad = defaultdict(list)
    for c in carreras:
        por_comunidad[c["comunidad"]].append(c)
    return "".join(
        f"<h3>{e(comunidad)} <small>({len(lista)})</small></h3><ul class=\"lista-carreras\">" + "".join(
            f'<li><a href="{prefijo}{e(rutas[c["id"]])}">{e(c["nombre"])}</a> '
            f'<span>{e(fecha_larga(c["fecha"]))} · {e(c.get("municipio"))} · {e(distancias_texto(c))}</span></li>'
            for c in lista) + "</ul>"
        for comunidad, lista in sorted(por_comunidad.items()))


def comprobar_enlaces_guias(slug_guia, texto):
    """Falla si una guía enlaza a otra que no existe (o si sus relacionadas no existen)."""
    existentes = {g["slug"] for g in GUIAS}
    guia = next(g for g in GUIAS if g["slug"] == slug_guia)
    rotos = [s for s in re.findall(r"\{\{R\}\}guias/([a-z0-9-]+)/", texto) + guia["relacionadas"]
             if s not in existentes]
    if rotos:
        raise ValueError(f"La guía '{slug_guia}' enlaza a guías que no existen: {', '.join(rotos)}")


def con_indice(texto):
    """Pone un id a cada <h2> y devuelve (texto, índice 'En esta guía')."""
    apartados = []

    def poner_id(m):
        ident = slug(re.sub(r"<[^>]+>", "", m.group(1)))
        apartados.append((ident, re.sub(r"<[^>]+>", "", m.group(1))))
        return f'<h2 id="{ident}">{m.group(1)}</h2>'
    texto = re.sub(r"<h2>(.*?)</h2>", poner_id, texto)
    if len(apartados) < 4:
        return texto, ""
    return texto, ('<nav class="indice" aria-label="En esta guía"><b>En esta guía</b><ol>' + "".join(
        f'<li><a href="#{i}">{t}</a></li>' for i, t in apartados) + "</ol></nav>")


def con_anuncios(texto):
    """Huecos de anuncio dentro de una guía: tras la introducción y antes del 3.er y 6.º apartado
    (si la guía es lo bastante larga). En la calculadora no se pone tras la introducción, para
    que el anuncio no quede pegado al formulario."""
    partes = re.split(r"(?=<h2[ >])", texto)   # partes[0] = introducción, partes[n] = apartado n
    for n in (6, 3):                            # de atrás adelante para no mover los índices
        if len(partes) > n + 1:
            partes[n] = hueco("articulo") + partes[n]
    texto = "".join(partes)
    return texto if "<form" in texto else re.sub(r"</p>", "</p>" + hueco("articulo"), texto, count=1)


def generar_guias(futuras, rutas):
    """Escribe guias/ y guias/<slug>/; devuelve sus entradas para el sitemap."""
    anio = str(date.today().year)
    por_slug = {g["slug"]: g for g in GUIAS}
    entradas = []
    for g in GUIAS:
        ruta = f"guias/{g['slug']}/"
        with open(os.path.join(RAIZ, "sitio", "guias", g["slug"] + ".html"), encoding="utf-8") as f:
            texto = f.read()
        comprobar_enlaces_guias(g["slug"], texto)
        marcas = {"{{R}}": "../../", "{{AÑO}}": anio}
        if "{{SAN_SILVESTRE}}" in texto:
            marcas["{{SAN_SILVESTRE}}"] = lista_san_silvestre(futuras, rutas, "../../")
        if "{{TABLA_RITMOS}}" in texto:
            marcas["{{TABLA_RITMOS}}"] = tabla_ritmos()
        for marca, valor in marcas.items():
            texto = texto.replace(marca, valor)
        titulo_seo = g["titulo_seo"].replace("{{AÑO}}", anio)
        descripcion = g["descripcion"].replace("{{AÑO}}", anio)

        faq = ('<section class="faq"><h2>Preguntas frecuentes</h2>' + "".join(
            f"<details><summary>{e(p)}</summary><p>{e(r)}</p></details>" for p, r in g["faq"]) + "</section>")
        sigue = ('<section class="sigue-leyendo"><h2>Sigue leyendo</h2><ul class="tarjetas-guias">' + "".join(
            f'<li><a href="../{s}/"><span class="icono">{por_slug[s]["icono"]}</span><b>{e(por_slug[s]["titulo"])}</b>'
            f'<span class="sub">{e(por_slug[s]["resumen"])}</span></a></li>' for s in g["relacionadas"])
            + '</ul><p><a href="../">Ver todas las guías para corredores →</a></p></section>')
        texto, indice = con_indice(texto)
        minutos = max(1, round(len(re.sub(r"<[^>]+>", " ", texto).split()) / 200))
        texto = con_anuncios(texto) + hueco()
        cuerpo = (f'<article class="guia"><p class="tema-guia">{e(g["tema"])}</p><h1>{g["icono"]} {e(g["titulo"])}</h1>'
                  f'<p class="fecha-guia">Equipo RunNear · actualizada el {e(fecha_larga(g["actualizada"]).split(", ")[1])}'
                  f" · {minutos} min de lectura</p>"
                  f"{indice}{texto}{faq}</article>{sigue}")
        datos = [
            {"@context": "https://schema.org", "@type": "Article", "headline": titulo_seo[:110],
             "description": descripcion, "datePublished": g["publicada"], "dateModified": g["actualizada"],
             "inLanguage": "es-ES", "mainEntityOfPage": SITIO_URL + ruta,
             "image": [SITIO_URL + "iconos/compartir.jpg"],
             "author": {"@type": "Organization", "name": "RunNear", "url": SITIO_URL},
             "publisher": {"@type": "Organization", "name": "RunNear", "url": SITIO_URL,
                           "logo": {"@type": "ImageObject", "url": SITIO_URL + "iconos/icono-512.png"}}},
            {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
                {"@type": "Question", "name": p, "acceptedAnswer": {"@type": "Answer", "text": r}} for p, r in g["faq"]]},
        ]
        migas = [("RunNear", ""), ("Guías", "guias/"), (g["titulo"], None)]
        escribir(ruta, pagina(f"{titulo_seo} | RunNear", descripcion, ruta, 2, cuerpo, migas, datos, tipo_og="article"))
        # La de San Silvestre cambia cada día (lleva la lista de carreras)
        entradas.append((SITIO_URL + ruta, date.today().isoformat() if "{{SAN_SILVESTRE}}" in marcas else g["actualizada"]))

    secciones = "".join(
        (hueco() if n == 2 else "")             # un anuncio a mitad del índice
        + f'<h2 id="{slug(tema)}">{e(tema)}</h2><ul class="tarjetas-guias">' + "".join(
            f'<li><a href="{g["slug"]}/"><span class="icono">{g["icono"]}</span><b>{e(g["titulo"])}</b>'
            f'<span class="sub">{e(g["resumen"])}</span></a></li>' for g in GUIAS if g["tema"] == tema) + "</ul>"
        for n, tema in enumerate(TEMAS))
    cuerpo = ("<h1>Guías para corredores</h1>"
              f'<p class="resumen">{len(GUIAS)} guías prácticas para empezar a correr, preparar tu 5K, 10K, '
              "media maratón o maratón, iniciarte en el trail, cuidar tu salud y disfrutar de las carreras "
              "populares y de montaña.</p>"
              '<nav class="temas">' + "".join(f'<a href="#{slug(t)}">{e(t)}</a>' for t in TEMAS) + "</nav>"
              + secciones
              + '<p class="acciones"><a class="boton principal" href="../calendario/">📅 Ver el calendario de carreras</a></p>')
    escribir("guias/", pagina("Guías para corredores: entrenamiento, planes, trail y nutrición | RunNear",
                              "Guías prácticas para corredores populares: empezar a correr, planes para 5K, 10K, media "
                              "maratón y maratón, trail, fuerza, alimentación, lesiones y calculadora de ritmo.",
                              "guias/", 1, cuerpo, [("RunNear", ""), ("Guías", None)]))
    entradas.append((SITIO_URL + "guias/", max(g["actualizada"] for g in GUIAS)))
    return entradas


def contenido_provincias_js(comunidad_de):
    """Texto de js/provincias.js a partir de {provincia: comunidad}."""
    pares = ",\n".join(f"  {json.dumps(p, ensure_ascii=False)}: {json.dumps(c, ensure_ascii=False)}"
                       for p, c in sorted(comunidad_de.items(), key=lambda x: (x[1], x[0])))
    return ("// Generado por sitio/generar.py a partir de scraper/comun.py: no editar a mano.\n"
            f"const COMUNIDAD_DE_PROVINCIA = {{\n{pares}\n}};\n")


def escribir_provincias_js():
    """js/provincias.js: provincia -> comunidad para el mapa (menú "Por zona" y "Añadir una carrera").
    Se genera desde scraper.comun.PROVINCIAS para que no haya dos listas que mantener."""
    contenido = contenido_provincias_js(COMUNIDAD_DE)
    ruta = os.path.join(RAIZ, "js", "provincias.js")
    actual = open(ruta, encoding="utf-8").read() if os.path.exists(ruta) else ""
    if actual != contenido:
        with open(ruta, "w", encoding="utf-8", newline="\n") as f:
            f.write(contenido)


def escribir(ruta, contenido):
    destino = os.path.join(RAIZ, *ruta.strip("/").split("/"), "index.html")
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "w", encoding="utf-8") as f:
        f.write(contenido)


if __name__ == "__main__":
    generar()
