"""
Utilidades compartidas por los adaptadores: descarga HTTP educada y normalización.
"""

import re
import time
import urllib.parse
import urllib.request

USER_AGENT = "RunNearBot/0.1 (prototipo calendario carreras CLM)"

# Pausa mínima entre peticiones al mismo sitio (segundos)
PAUSA_ENTRE_PETICIONES = 2.0
_ultima_peticion = {}

PROVINCIAS_CLM = {
    "AB": "Albacete",
    "CR": "Ciudad Real",
    "CU": "Cuenca",
    "GU": "Guadalajara",
    "TO": "Toledo",
}


def descargar(url, timeout=30):
    """Descarga una URL como texto respetando una pausa entre peticiones al mismo host."""
    host = urllib.parse.urlparse(url).netloc
    espera = PAUSA_ENTRE_PETICIONES - (time.time() - _ultima_peticion.get(host, 0))
    if espera > 0:
        time.sleep(espera)

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        _ultima_peticion[host] = time.time()
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def extraer_distancias_km(texto):
    """'4km, 8km' -> [4.0, 8.0]; '21,097 km' -> [21.097]. Devuelve lista ordenada sin duplicados."""
    if not texto:
        return []
    valores = re.findall(r"(\d+(?:[.,]\d+)?)\s*k(?:m|ms)?\b", texto, flags=re.IGNORECASE)
    distancias = {round(float(v.replace(",", ".")), 3) for v in valores}
    return sorted(d for d in distancias if 0 < d < 400)
