"""
Genera las páginas estáticas de RunNear que Google puede leer e indexar (la web principal
es un mapa dibujado con JavaScript, que los buscadores apenas ven):

  carrera/<slug>/index.html                  una página por carrera, con datos estructurados
                                             schema.org/SportsEvent (resultados destacados)
  calendario/index.html                      calendario de toda España por comunidades
  calendario/<comunidad>/index.html          carreras de la comunidad, por meses
  calendario/<comunidad>/<provincia>/        carreras de la provincia, por meses
  sitemap.xml, robots.txt                    para los buscadores

Se genera en cada publicación (GitHub Actions) a partir de carreras.json y NO se guarda en
el repositorio (.gitignore). Todos los enlaces son relativos, así que funciona igual en
fran-1512.github.io/RunNear/ que en un dominio propio: al cambiar de dirección solo hay
que tocar SITIO_URL (enlaces canónicos y sitemap).

Uso (desde la carpeta del proyecto):
    py -m sitio.generar
"""

import html
import json
import math
import os
import re
import shutil
import sys
import unicodedata
from collections import defaultdict
from datetime import date, timedelta

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITIO_URL = "https://fran-1512.github.io/RunNear/"   # cambiar al conectar el dominio propio
SALIDAS = ["carrera", "calendario"]                    # carpetas generadas (se borran y rehacen)

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]
COMUNIDAD_DE = {}  # provincia -> comunidad (se rellena con scraper.comun)


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def e(texto):
    """Escapa texto para HTML."""
    return html.escape(str(texto if texto is not None else ""), quote=True)


def slug(texto):
    t = unicodedata.normalize("NFD", str(texto or ""))
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:80] or "carrera"


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


def fecha_larga(iso):
    d = date.fromisoformat(iso)
    return f"{DIAS[d.weekday()]}, {d.day} de {MESES[d.month - 1]} de {d.year}"


def km_texto(km):
    return f"{km:g}".replace(".", ",") + " km"


def distancias_texto(c):
    lista = c.get("distancias_km") or ([c["distancia_km"]] if c.get("distancia_km") else [])
    return " / ".join(km_texto(k) for k in lista) if lista else "Distancia por confirmar"


def precio_texto(p):
    return (f"{p:g}".replace(".", ",") if float(p).is_integer() else f"{p:.2f}".replace(".", ",")) + " €"


def tipo_texto(c):
    return "Trail / montaña" if c.get("tipo") == "trail" else "Asfalto (carrera popular)"


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


# ---------------------------------------------------------------------------
# Plantilla común
# ---------------------------------------------------------------------------

def pagina(titulo, descripcion, ruta, profundidad, cuerpo, migas, datos_estructurados=None, imagen=None):
    """ruta: dirección relativa de la página (para el enlace canónico), p. ej. 'carrera/x/'."""
    r = relativo(profundidad)
    canonica = SITIO_URL + ruta
    migas_html = " › ".join(
        f'<a href="{r}{e(url)}">{e(texto)}</a>' if url is not None else f"<span>{e(texto)}</span>"
        for texto, url in migas)
    ld = ""
    if datos_estructurados:
        ld = "\n".join(f'<script type="application/ld+json">{json.dumps(d, ensure_ascii=False)}</script>'
                       for d in datos_estructurados)
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{e(titulo)}</title>
<meta name="description" content="{e(descripcion)}">
<link rel="canonical" href="{e(canonica)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RunNear">
<meta property="og:locale" content="es_ES">
<meta property="og:url" content="{e(canonica)}">
<meta property="og:title" content="{e(titulo)}">
<meta property="og:description" content="{e(descripcion)}">
<meta property="og:image" content="{e(imagen or SITIO_URL + 'iconos/compartir.jpg')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0c1220">
<link rel="icon" type="image/png" sizes="32x32" href="{r}iconos/favicon-32.png">
<link rel="stylesheet" href="{r}vendor/fonts/fonts.css">
<link rel="stylesheet" href="{r}paginas.css">
{ld}
</head>
<body>
<header class="cabecera">
  <a class="marca" href="{r}"><img src="{r}iconos/icono-192.png" alt="" width="34" height="34"><span>Run<b>Near</b></span></a>
  <nav class="nav">
    <a href="{r}calendario/">Calendario</a>
    <a class="boton" href="{r}">Abrir el mapa</a>
  </nav>
</header>
<main class="contenido">
<nav class="migas" aria-label="Estás en">{migas_html}</nav>
{cuerpo}
</main>
<footer class="pie">
  <p>RunNear reúne las carreras populares y de trail de España en un mapa. Los datos se recopilan
  cada día de calendarios públicos y de las webs de cada carrera, citando siempre la fuente:
  confirma siempre fecha y condiciones en la web oficial antes de inscribirte.</p>
  <p><a href="{r}">Mapa de carreras</a> · <a href="{r}calendario/">Calendario por zonas</a> ·
  <a href="{r}legal.html">Privacidad y aviso legal</a></p>
</footer>
</body>
</html>
"""


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
    datos = {
        "@context": "https://schema.org", "@type": "SportsEvent", "name": c["nombre"],
        "startDate": inicio, "eventStatus": f"https://schema.org/{estado}",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "location": lugar, "url": url, "sport": "Atletismo",
        "description": descripcion_carrera(c),
        "image": [SITIO_URL + "iconos/compartir.jpg"],
    }
    if c.get("precio_desde") is not None:
        datos["offers"] = {"@type": "Offer", "price": c["precio_desde"], "priceCurrency": "EUR",
                           "url": c.get("url_oficial") or url}
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


def pagina_carrera(c, ruta, cercanas, misma_provincia, url_provincia):
    url = SITIO_URL + ruta
    hoy = date.today().isoformat()
    celebrada = c["fecha"] < hoy
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
    elif celebrada:
        aviso = '<p class="aviso">🏅 Esta carrera ya se ha celebrado. Consulta los resultados en su web oficial.</p>'

    enlaces_resultados = ""
    if celebrada:
        enlaces = [(r.get("texto") or "Resultados", r["url"]) for r in c.get("resultados") or []
                   if isinstance(r, dict) and r.get("url")]
        repetidos = {t for t, _ in enlaces if sum(1 for x, _ in enlaces if x == t) > 1}
        enlaces = [(f"{t} · {u.rstrip('/').rsplit('/', 1)[-1]}" if t in repetidos else t, u) for t, u in enlaces]
        if c.get("resultados_web"):
            enlaces.append(("Todas las clasificaciones", c["resultados_web"]))
        if enlaces:
            enlaces_resultados = "<h2>Resultados</h2><ul>" + "".join(
                f'<li><a href="{e(u)}" rel="nofollow noopener" target="_blank">{e(t)} ↗</a></li>'
                for t, u in enlaces) + "</ul>"

    fuentes = c.get("fuentes") or [c.get("fuente", {}).get("nombre")]
    origen = ("Datos facilitados por la organización de la carrera." if c.get("verificada_organizador")
              else f"Datos recopilados de {e(', '.join(f for f in fuentes if f))}.")

    def lista(carreras, con_distancia=False):
        return "<ul class=\"lista-carreras\">" + "".join(
            f'<li><a href="../{e(r)}/">{e(x["nombre"])}</a> <span>{e(fecha_larga(x["fecha"]))} · '
            f'{e(x.get("municipio"))}{(f" · a {d:.0f} km" if d >= 1 else " · en la misma localidad") if con_distancia else ""}</span></li>'
            for x, r, d in carreras) + "</ul>"

    cuerpo = f"""
<article class="carrera">
  <p class="etiqueta {'trail' if c.get('tipo') == 'trail' else 'asfalto'}">{'⛰️ Trail' if c.get('tipo') == 'trail' else '🏃 Asfalto'}</p>
  <h1>{e(c['nombre'])}</h1>
  <p class="resumen">{e(descripcion_carrera(c))}</p>
  {aviso}
  <dl class="datos">{''.join(f'<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in filas)}</dl>
  <p class="acciones">
    <a class="boton principal" href="{e(c.get('url_oficial') or '#')}" rel="noopener" target="_blank">{'Ver en la web oficial' if celebrada else 'Inscripción en la web oficial'} ↗</a>
    <a class="boton" href="../../?carrera={e(c['id'])}">📍 Ver en el mapa</a>
  </p>
  {f'<h2>Sobre la carrera</h2><p>{e(c["descripcion"])}</p>' if c.get("descripcion") else ''}
  {enlaces_resultados}
  <p class="origen">{origen} Confirma fecha, horario y condiciones en la web oficial antes de inscribirte.</p>
</article>
{f'<section><h2>Carreras cerca</h2>{lista(cercanas, True)}</section>' if cercanas else ''}
{f'<section><h2>Más carreras en {e(c.get("provincia"))}</h2>{lista(misma_provincia)}<p><a href="../../{e(url_provincia)}">Ver todo el calendario de {e(c.get("provincia"))} →</a></p></section>' if misma_provincia else ''}
"""
    titulo = f"{c['nombre']} · {fecha_larga(c['fecha'])} · {c.get('municipio')} | RunNear"
    migas = [("RunNear", ""), ("Calendario", "calendario/")]
    if c.get("comunidad"):
        migas.append((c["comunidad"], f"calendario/{slug(c['comunidad'])}/"))
    migas += [(c.get("provincia"), url_provincia), (c["nombre"], None)]
    return pagina(titulo, descripcion_carrera(c)[:300], ruta, 2, cuerpo, migas, [datos_evento(c, url)])


# ---------------------------------------------------------------------------
# Calendarios por zona
# ---------------------------------------------------------------------------

def tabla_por_meses(carreras, rutas, prefijo):
    por_mes = defaultdict(list)
    for c in sorted(carreras, key=lambda x: (x["fecha"], x["nombre"])):
        por_mes[c["fecha"][:7]].append(c)
    bloques = []
    for mes, lista in por_mes.items():
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

    # Dirección de cada carrera (estable entre ediciones; si coinciden, se añade la fecha)
    rutas, usadas = {}, set()
    for c in sorted(carreras, key=lambda x: (x["fecha"], x["id"])):
        s = slug_evento(c)
        if s in usadas:
            s = f"{s}-{c['fecha']}"
        usadas.add(s)
        rutas[c["id"]] = f"carrera/{s}/"

    futuras = [c for c in carreras if c["fecha"] >= hoy]
    por_provincia, por_comunidad = defaultdict(list), defaultdict(list)
    for c in futuras:
        por_provincia[c["provincia"]].append(c)
        por_comunidad[c["comunidad"]].append(c)

    n_provincias = defaultdict(int)
    for comunidad in COMUNIDAD_DE.values():
        n_provincias[comunidad] += 1

    def ruta_provincia(p):
        """Las comunidades de una sola provincia (Madrid, Asturias…) no tienen página de
        provincia: sería una copia exacta de la de la comunidad."""
        comunidad = COMUNIDAD_DE[p]
        return f"calendario/{slug(comunidad)}/" + ("" if n_provincias[comunidad] == 1 else f"{slug(p)}/")

    sitemap = [(SITIO_URL, hoy), (SITIO_URL + "calendario/", hoy), (SITIO_URL + "legal.html", hoy)]

    # 1) Carreras
    con_ubicacion = [c for c in futuras if c.get("ubicacion")]
    for c in carreras:
        ruta = rutas[c["id"]]
        cercanas = []
        if c.get("ubicacion"):
            dist = sorted(((x, haversine(c["ubicacion"], x["ubicacion"])) for x in con_ubicacion if x["id"] != c["id"]),
                          key=lambda p: p[1])
            cercanas = [(x, rutas[x["id"]].split("/")[1], d) for x, d in dist[:6] if d <= 60]
        cerca_ids = {x["id"] for x, _, _ in cercanas}
        misma = [(x, rutas[x["id"]].split("/")[1], 0) for x in sorted(por_provincia.get(c["provincia"], []), key=lambda x: x["fecha"])
                 if x["id"] != c["id"] and x["id"] not in cerca_ids][:8]
        escribir(ruta, pagina_carrera(c, ruta, cercanas, misma, ruta_provincia(c["provincia"])))
        sitemap.append((SITIO_URL + ruta, c.get("actualizado") or hoy))

    # 2) Provincias
    for p, lista in por_provincia.items():
        comunidad = COMUNIDAD_DE[p]
        if n_provincias[comunidad] == 1:
            continue
        ruta = ruta_provincia(p)
        vecinas = sorted(x for x in por_provincia if COMUNIDAD_DE.get(x) == comunidad and x != p)
        cuerpo = (f"<h1>Carreras populares y trail en {e(p)}</h1>"
                  f'<p class="resumen">{e(resumen_zona("la provincia de " + p, lista))}</p>'
                  f'<p class="acciones"><a class="boton principal" href="../../../">📍 Ver en el mapa</a></p>'
                  + tabla_por_meses(lista, rutas, "../../../")
                  + (f"<section><h2>Otras provincias de {e(comunidad)}</h2><ul class=\"zonas\">"
                     + "".join(f'<li><a href="../{slug(x)}/">{e(x)} <span>{len(por_provincia[x])}</span></a></li>' for x in vecinas)
                     + "</ul></section>" if vecinas else ""))
        titulo = f"Carreras populares y trail en {p} {date.today().year} · Calendario | RunNear"
        desc = f"Calendario de carreras populares y trail en {p}: {len(lista)} próximas carreras con fecha, distancias, precio e inscripción."
        migas = [("RunNear", ""), ("Calendario", "calendario/"), (comunidad, f"calendario/{slug(comunidad)}/"), (p, None)]
        escribir(ruta, pagina(titulo, desc, ruta, 3, cuerpo, migas))
        sitemap.append((SITIO_URL + ruta, hoy))

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
                  f'<p class="acciones"><a class="boton principal" href="../../">📍 Ver en el mapa</a></p>'
                  + tabla_por_meses(lista, rutas, "../../"))
        titulo = f"Carreras populares y trail en {comunidad} {date.today().year} · Calendario | RunNear"
        desc = f"Calendario de carreras en {comunidad}: {len(lista)} próximas carreras populares y de trail por provincias, con fechas y distancias."
        escribir(ruta, pagina(titulo, desc, ruta, 2, cuerpo, [("RunNear", ""), ("Calendario", "calendario/"), (comunidad, None)]))
        sitemap.append((SITIO_URL + ruta, hoy))

    # 4) España
    comunidades = sorted(por_comunidad, key=lambda x: x)
    cuerpo = ("<h1>Calendario de carreras populares y trail en España</h1>"
              f'<p class="resumen">{e(resumen_zona("España", futuras, "en toda"))}</p>'
              "<h2>Por comunidades</h2><ul class=\"zonas grande\">"
              + "".join(f'<li><a href="{slug(x)}/">{e(x)} <span>{len(por_comunidad[x])}</span></a></li>' for x in comunidades)
              + "</ul>"
              + "<h2>Próximas carreras</h2>"
              + tabla_por_meses(sorted(futuras, key=lambda x: x["fecha"])[:40], rutas, "../")
              + '<p class="acciones"><a class="boton principal" href="../">📍 Ver todas en el mapa</a></p>')
    escribir("calendario/", pagina(
        f"Calendario de carreras populares y trail en España {date.today().year} | RunNear",
        f"Calendario de {len(futuras)} carreras populares y de trail en España por comunidades y provincias, con fechas, distancias y enlace a la inscripción.",
        "calendario/", 1, cuerpo, [("RunNear", ""), ("Calendario", None)]))

    # 5) Para los buscadores
    with open(os.path.join(RAIZ, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for url, fecha in sitemap:
            f.write(f"  <url><loc>{e(url)}</loc><lastmod>{fecha}</lastmod></url>\n")
        f.write("</urlset>\n")
    with open(os.path.join(RAIZ, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(f"User-agent: *\nAllow: /\n\nSitemap: {SITIO_URL}sitemap.xml\n")

    print(f"OK: {len(carreras)} páginas de carreras, "
          f"{sum(1 for p in por_provincia if n_provincias[COMUNIDAD_DE[p]] > 1)} de provincias, "
          f"{len(por_comunidad)} de comunidades y el sitemap ({len(sitemap)} direcciones)")


def escribir(ruta, contenido):
    destino = os.path.join(RAIZ, *ruta.strip("/").split("/"), "index.html")
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "w", encoding="utf-8") as f:
        f.write(contenido)


if __name__ == "__main__":
    generar()
