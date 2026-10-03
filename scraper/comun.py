"""
Utilidades compartidas por los adaptadores: descarga HTTP educada (con robots.txt),
normalización de textos, fechas y municipios, y provincia a partir de coordenadas.
"""

import html as html_lib
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from urllib import robotparser

USER_AGENT = "RunNearBot/0.1 (prototipo calendario carreras CLM)"

# Pausa mínima entre peticiones al mismo sitio (segundos)
PAUSA_ENTRE_PETICIONES = 2.0
_ultima_peticion = {}
_robots = {}

PROVINCIAS_CLM = {
    "AB": "Albacete",
    "CR": "Ciudad Real",
    "CU": "Cuenca",
    "GU": "Guadalajara",
    "TO": "Toledo",
}

MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
         "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}


# ---------------------------------------------------------------------------
# Descarga
# ---------------------------------------------------------------------------

def descargar(url, timeout=30):
    """Descarga una URL como texto respetando una pausa entre peticiones al mismo host."""
    host = urllib.parse.urlparse(url).netloc
    espera = PAUSA_ENTRE_PETICIONES - (time.time() - _ultima_peticion.get(host, 0))
    if espera > 0:
        time.sleep(espera)

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            return resp.read().decode(charset, errors="replace")
    finally:
        _ultima_peticion[host] = time.time()


def permitido(url):
    """¿Permite el robots.txt del sitio visitar esta URL? (se consulta una vez por sitio)"""
    p = urllib.parse.urlparse(url)
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


def descargar_permitido(url, timeout=30):
    """Descarga solo si robots.txt lo permite; si no, lanza PermissionError."""
    if not permitido(url):
        raise PermissionError(f"robots.txt no permite {url}")
    return descargar(url, timeout)


# ---------------------------------------------------------------------------
# Textos
# ---------------------------------------------------------------------------

def texto_visible(h):
    """HTML -> texto plano en una línea."""
    h = re.sub(r"<(script|style)\b.*?</\1>", " ", h, flags=re.S | re.I)
    h = re.sub(r"<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", html_lib.unescape(h)).strip()


def normalizar(texto):
    """'Alcázar  de San-Juan' -> 'alcazar de san juan' (sin tildes, minúsculas, solo letras y números)."""
    t = unicodedata.normalize("NFD", str(texto or ""))
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn").lower()
    return re.sub(r"[^a-z0-9ñ]+", " ", t).strip()


_MINUSCULAS = {"de", "del", "la", "las", "los", "el", "y", "e", "en", "a"}


def titulo_municipio(nombre):
    """'ALCALÁ DEL JÚCAR' -> 'Alcalá del Júcar'; 'HOYA-GONZALO' -> 'Hoya-Gonzalo'."""
    nombre = re.sub(r"\s+", " ", (nombre or "").strip())
    if not nombre or not nombre.isupper():
        return nombre
    palabras = []
    for i, p in enumerate(nombre.lower().split(" ")):
        p = "-".join(s[:1].upper() + s[1:] for s in p.split("-"))
        palabras.append(p.lower() if i > 0 and p.lower() in _MINUSCULAS else p)
    return " ".join(palabras)


def titulo_carrera(nombre):
    """Nombres EN MAYÚSCULAS -> 'Tipo título' (respetando números romanos y siglas cortas)."""
    nombre = re.sub(r"\s+", " ", (nombre or "").strip())
    if not nombre or not nombre.isupper():
        return nombre
    salida = []
    for i, p in enumerate(nombre.split(" ")):
        limpio = re.sub(r"[^\w]", "", p)
        if re.fullmatch(r"[IVXLCDM]+", limpio) or re.fullmatch(r"\d+[KkMm]?", limpio) or limpio in {"CXM", "BTT", "UTMB"}:
            salida.append(p)
        elif i > 0 and p.lower() in _MINUSCULAS:
            salida.append(p.lower())
        else:
            salida.append("-".join(s[:1].upper() + s[1:].lower() for s in p.split("-")))
    return " ".join(salida)


def normalizar_provincia(texto):
    """'CIUDAD REAL' / 'ciudad real' / 'CR' -> 'Ciudad Real'; None si no es de Castilla-La Mancha."""
    if not texto:
        return None
    t = normalizar(texto)
    for codigo, nombre in PROVINCIAS_CLM.items():
        if t in (normalizar(nombre), codigo.lower()):
            return nombre
    return None


# ---------------------------------------------------------------------------
# Distancias y fechas
# ---------------------------------------------------------------------------

def extraer_distancias_km(texto):
    """'4km, 8km' -> [4.0, 8.0]; '21,097 km' -> [21.097]. Devuelve lista ordenada sin duplicados."""
    if not texto:
        return []
    valores = re.findall(r"(\d+(?:[.,]\d+)?)\s*(?:k(?:m|ms)?\b|kil[oó]metros|kilometers)", texto, flags=re.IGNORECASE)
    distancias = {round(float(v.replace(",", ".")), 3) for v in valores}
    return sorted(d for d in distancias if 0 < d < 400)


def distancias_por_nombre(nombre):
    """Distancias que se deducen del nombre: '10K Ciudad de X' -> [10], 'Media Maratón' -> [21.097]."""
    t = normalizar(nombre)
    distancias = set(extraer_distancias_km(nombre))
    if re.search(r"\b(media|medio) maraton\b", t):
        distancias.add(21.097)
    elif re.search(r"\bmaraton\b", t):
        distancias.add(42.195)
    if re.search(r"\bmilla\b", t):
        distancias.add(1.609)
    return sorted(distancias)


def extraer_desnivel(texto):
    """'+1.700 m de desnivel', 'desnivel+670m', 'D+ 1200' -> int o None"""
    if not texto:
        return None
    num = r"(\d{1,2}[.,]\d{3}|\d{2,4})"
    patrones = [
        r"\+\s?" + num + r"\s*(?:m|metros)\b",
        r"desnivel\s*(?:positivo)?\s*(?:acumulado)?\s*(?:de\s*)?\+?\s*" + num,
        r"D\+\s*" + num,
    ]
    valores = []
    for p in patrones:
        valores += [int(re.sub(r"[.,]", "", m)) for m in re.findall(p, texto, flags=re.I)]
    validos = [v for v in valores if 50 <= v <= 8000]
    return max(validos) if validos else None


def fecha_ddmmaaaa(texto):
    """'04/10/2026' o '15-11-2026' -> '2026-10-04'"""
    m = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})", texto or "")
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else None


def fecha_texto(texto, anio_por_defecto=None):
    """'Domingo 11 octubre 2026' / '18 de octubre' / '1 de febrero de 2026' -> 'AAAA-MM-DD'"""
    m = re.search(r"(\d{1,2})\s+(?:de\s+)?(" + "|".join(MESES) + r")(?:\s+(?:de\s+)?(\d{4}))?",
                  normalizar(texto))
    if not m:
        return None
    anio = int(m.group(3)) if m.group(3) else anio_por_defecto
    if not anio:
        return None
    return f"{anio}-{MESES[m.group(2)]:02d}-{int(m.group(1)):02d}"


def tipo_por_nombre(nombre, extra=""):
    """'trail' si el nombre o la descripción suenan a montaña; si no, 'popular'."""
    t = normalizar(f"{nombre} {extra}")
    return "trail" if re.search(r"\btrail\b|\bcxm\b|montana|\bsky\b|\bvertical\b|\bultra\b|desafio|subida", t) else "popular"


# ---------------------------------------------------------------------------
# Provincia a partir de coordenadas (contornos del mapa base propio)
# ---------------------------------------------------------------------------

_provincias_geo = None


def _cargar_provincias():
    global _provincias_geo
    if _provincias_geo is None:
        ruta = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mapa", "mapa_base.json")
        _provincias_geo = []
        if os.path.exists(ruta):
            with open(ruta, "r", encoding="utf-8") as f:
                capas = json.load(f)["capas"]
            for f in capas["provincias"]["features"]:
                if f["properties"].get("destacada"):
                    g = f["geometry"]
                    poligonos = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
                    _provincias_geo.append((f["properties"]["nombre"], poligonos))
    return _provincias_geo


def provincia_por_punto(lat, lng):
    """Provincia de Castilla-La Mancha que contiene el punto, o None."""
    for nombre, poligonos in _cargar_provincias():
        dentro = False
        for anillos in poligonos:
            for anillo in anillos:
                n = len(anillo)
                for i in range(n):
                    x1, y1 = anillo[i]
                    x2, y2 = anillo[i - 1]
                    if (y1 > lat) != (y2 > lat) and lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                        dentro = not dentro
        if dentro:
            return normalizar_provincia(nombre)
    return None
