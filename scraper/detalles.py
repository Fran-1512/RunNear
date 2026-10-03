"""
Enriquecimiento de carreras: precio de inscripción y desnivel (solo trail) leídos
de la web de inscripción de cada carrera (Rock The Sport, Dipualba, Sportmaniacs...).

- Respeta el robots.txt de cada plataforma (si lo prohíbe o responde 401/403, no se visita).
- Cada página se consulta como mucho una vez cada DIAS_VALIDEZ días (caché en disco).
- Extracción genérica: datos estructurados (JSON-LD "price") y patrones de texto
  ("20,00 €", "(15 Euros)", "+850 m desnivel", "1.400 metros de desnivel positivo").
"""

import html as html_lib
import json
import os
import re
import urllib.error
from datetime import date, timedelta
from urllib import robotparser
from urllib.parse import urlparse

from .comun import USER_AGENT, descargar

CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "detalles_cache.json")
# Los inscritos cambian a diario: cada página se revisa como mucho cada 2 días
DIAS_VALIDEZ = 2
# Si cambia lo que se extrae de cada página, subir este número para volver a leerlas
VERSION_EXTRACCION = 4

# Rangos plausibles: descartan "cambio de modalidad 3 €", "ludoteca 0,00 €", etc.
PRECIO_MIN, PRECIO_MAX = 5.0, 300.0
DESNIVEL_MIN, DESNIVEL_MAX = 50, 8000
INSCRITOS_MIN, INSCRITOS_MAX = 10, 30000

_robots = {}


def _permitido(url):
    """Consulta (y cachea en memoria) el robots.txt del sitio."""
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = robotparser.RobotFileParser()
        try:
            rp.parse(descargar(base + "/robots.txt", timeout=15).splitlines())
        except urllib.error.HTTPError as e:
            # Mismo criterio que la librería estándar: 401/403 = prohibido, otros (404) = permitido
            if e.code in (401, 403):
                rp.disallow_all = True
            else:
                rp.allow_all = True
        except Exception:
            rp.disallow_all = True  # ante la duda, no visitar
        _robots[base] = rp
    return _robots[base].can_fetch(USER_AGENT, url)


def _texto_visible(h):
    h = re.sub(r"<(script|style)\b.*?</\1>", " ", h, flags=re.S | re.I)
    h = re.sub(r"<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", html_lib.unescape(h))


def _numero_decimal(s):
    """'20.00' / '9,00' / '15' -> float"""
    return float(s.replace(",", "."))


def _numero_entero(s):
    """'1.400' / '1,400' / '850' -> int (los desniveles no llevan decimales)"""
    return int(re.sub(r"[.,]", "", s))


def _precios_jsonld(h):
    precios = []

    def recorrer(nodo):
        if isinstance(nodo, dict):
            for k, v in nodo.items():
                if k in ("price", "lowPrice") and isinstance(v, (str, int, float)):
                    try:
                        precios.append(_numero_decimal(str(v)))
                    except ValueError:
                        pass
                else:
                    recorrer(v)
        elif isinstance(nodo, list):
            for x in nodo:
                recorrer(x)

    for bloque in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', h, flags=re.S):
        try:
            recorrer(json.loads(bloque))
        except ValueError:
            pass
    return precios


def extraer_precio(h):
    """Precio mínimo plausible ("desde") o None."""
    candidatos = _precios_jsonld(h)
    texto = _texto_visible(h)
    num = r"(\d{1,3}(?:[.,]\d{1,2})?)"
    candidatos += [_numero_decimal(m) for m in re.findall(num + r"\s*(?:€|euros?\b|EUR\b)", texto, flags=re.I)]
    candidatos += [_numero_decimal(m) for m in re.findall(r"€\s*" + num, texto)]
    validos = [p for p in candidatos if PRECIO_MIN <= p <= PRECIO_MAX]
    return min(validos) if validos else None


def extraer_desnivel(h):
    """Mayor desnivel positivo plausible (corresponde a la distancia más larga) o None."""
    texto = _texto_visible(h)
    num = r"(\d{1,2}[.,]\d{3}|\d{2,4})"
    patrones = [
        # "+850 m desnivel", "1.400 METROS DE DESNIVEL POSITIVO", "1200m D+"
        num + r"\s*(?:m|mts|metros)\.?\s*(?:de\s+)?(?:desnivel|D\+)",
        # "Desnivel positivo: 900 m", "D+ 1.200", "desnivel acumulado +1500"
        r"(?:desnivel(?:\s+positivo)?(?:\s+acumulado)?|D\+)\s*[:=]?\s*\+?\s*" + num,
    ]
    valores = []
    for patron in patrones:
        valores += [_numero_entero(m) for m in re.findall(patron, texto, flags=re.I)]
    validos = [v for v in valores if DESNIVEL_MIN <= v <= DESNIVEL_MAX]
    return max(validos) if validos else None


def _numero_personas(s):
    """'1.250' / '1250' / '272' -> int"""
    return int(re.sub(r"[.,\s]", "", s))


def extraer_inscritos(h):
    """Inscritos actuales si la web los publica ("272 Participantes inscritos", "Total inscritos 58")."""
    texto = _texto_visible(h)
    num = r"(\d{1,2}[.,]\d{3}|\d{1,5})"
    patrones = [
        num + r"\s+participantes\s+inscritos",
        r"total\s+(?:de\s+)?inscritos\s*:?\s*" + num,
        r"inscritos\s+(?:hasta\s+(?:el\s+)?momento|actualmente)\s*:?\s*" + num,
    ]
    valores = []
    for patron in patrones:
        valores += [_numero_personas(m) for m in re.findall(patron, texto, flags=re.I)]
    validos = [v for v in valores if INSCRITOS_MIN <= v <= INSCRITOS_MAX]
    return max(validos) if validos else None


def extraer_plazas(h):
    """Límite de participantes ("Máximo participantes: 750", "límite de 450 dorsales")."""
    texto = _texto_visible(h)
    num = r"(\d{1,2}[.,]\d{3}|\d{2,5})"
    patrones = [
        r"m[aá]ximo\s+(?:de\s+)?participantes\s*:?\s*" + num,
        r"l[ií]mite\s+(?:de\s+)?" + num + r"\s+(?:dorsales|plazas|participantes|corredores|inscritos)",
        r"plazas\s+limitadas\s+a\s+" + num,
        num + r"\s+(?:plazas|dorsales)\s+(?:disponibles|como\s+m[aá]ximo|m[aá]ximo)",
        r"(?:n[uú]mero\s+)?m[aá]ximo\s+de\s+" + num + r"\s+(?:dorsales|plazas|participantes|corredores)",
    ]
    valores = []
    for patron in patrones:
        valores += [_numero_personas(m) for m in re.findall(patron, texto, flags=re.I)]
    # Datos estructurados (schema.org): maximumAttendeeCapacity
    valores += [int(v) for v in re.findall(r'"maximumAttendeeCapacity"\s*:\s*"?(\d{2,5})', h)]
    validos = [v for v in valores if INSCRITOS_MIN <= v <= INSCRITOS_MAX]
    return max(validos) if validos else None


def extraer_estado(h):
    """'cancelada' / 'suspendida' / 'aplazada' si lo indica el título de la prueba.

    Solo se mira en títulos (<title>, <h1>-<h3> o elementos con clase "titulo"/"title")
    para no confundirse con textos del reglamento ("en caso de suspensión...").
    """
    patron = (r"<(title|h[1-3])\b[^>]*>(.*?)</\1>"
              r"|<(p|div|span)\b[^>]*class=\"[^\"]*(?:titul|title)[^\"]*\"[^>]*>(.*?)</\3>")
    trozos = re.findall(patron, h, flags=re.S | re.I)
    cabecera = html_lib.unescape(" ".join(t[1] + " " + t[3] for t in trozos))
    cabecera = re.sub(r"<[^>]+>", " ", cabecera)
    m = re.search(r"\b(cancelad|suspendid|aplazad)[ao]\b", cabecera, flags=re.I)
    return {"cancelad": "cancelada", "suspendid": "suspendida", "aplazad": "aplazada"}[m.group(1).lower()] if m else None


def _cargar_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _guardar_cache(cache):
    temporal = CACHE_FILE + ".tmp"
    with open(temporal, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(temporal, CACHE_FILE)


def enriquecer(carreras):
    """Añade precio_desde (y desnivel_positivo_m si es trail) a cada carrera, in situ."""
    cache = _cargar_cache()
    limite = (date.today() - timedelta(days=DIAS_VALIDEZ)).isoformat()
    consultadas = bloqueadas = 0

    for c in carreras:
        url = c.get("url_oficial")
        if not url:
            continue
        entrada = cache.get(url)

        caducada = (not entrada or entrada.get("consultado", "") < limite
                    or entrada.get("version") != VERSION_EXTRACCION)
        if caducada:
            if not _permitido(url):
                entrada = {"consultado": date.today().isoformat(), "version": VERSION_EXTRACCION,
                           "bloqueado_robots": True}
                bloqueadas += 1
            else:
                try:
                    h = descargar(url)
                    entrada = {
                        "consultado": date.today().isoformat(),
                        "version": VERSION_EXTRACCION,
                        "precio_desde": extraer_precio(h),
                        "desnivel_positivo_m": extraer_desnivel(h),
                        "inscritos": extraer_inscritos(h),
                        "plazas_max": extraer_plazas(h),
                        "estado": extraer_estado(h),
                    }
                    consultadas += 1
                except Exception as e:
                    print(f"  [detalles] No se pudo leer {url}: {e}")
                    continue  # se reintentará en la próxima ejecución
            cache[url] = entrada

        if entrada.get("precio_desde") is not None:
            c["precio_desde"] = entrada["precio_desde"]
        # El desnivel solo tiene sentido en trail
        if c.get("tipo") == "trail" and entrada.get("desnivel_positivo_m") is not None:
            c["desnivel_positivo_m"] = entrada["desnivel_positivo_m"]
        # Tamaño de la carrera (para "Más destacadas")
        if entrada.get("inscritos") is not None:
            c["inscritos"] = entrada["inscritos"]
        if entrada.get("plazas_max") is not None:
            c["plazas_max"] = entrada["plazas_max"]
        # Cancelada / suspendida / aplazada según la web de inscripción
        if entrada.get("estado"):
            c["estado"] = entrada["estado"]

    _guardar_cache(cache)
    con_precio = sum(1 for c in carreras if c.get("precio_desde") is not None)
    trails = [c for c in carreras if c.get("tipo") == "trail"]
    con_desnivel = sum(1 for c in trails if c.get("desnivel_positivo_m") is not None)
    con_inscritos = sum(1 for c in carreras if c.get("inscritos") is not None)
    con_plazas = sum(1 for c in carreras if c.get("plazas_max") is not None)
    print(f"  [detalles] {consultadas} páginas consultadas, {bloqueadas} bloqueadas por robots.txt")
    print(f"  [detalles] con precio: {con_precio}/{len(carreras)} | trail con desnivel: {con_desnivel}/{len(trails)}")
    print(f"  [detalles] con inscritos: {con_inscritos} | con plazas máximas: {con_plazas}")
