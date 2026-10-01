"""
Geocodificación de municipios con Nominatim (OpenStreetMap), gratuito y sin API key.

Política de uso de Nominatim: máximo 1 petición/segundo, User-Agent identificable
y cachear resultados. Por eso cada municipio se consulta una sola vez y se guarda
en geocache.json.
"""

import json
import os
import time
import urllib.parse
import urllib.request

from .comun import USER_AGENT

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geocache.json")

_cache = None
_ultima_peticion = 0.0


def _cargar_cache():
    global _cache
    if _cache is None:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                _cache = json.load(f)
        else:
            _cache = {}
    return _cache


def guardar_cache():
    if _cache is not None:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False, indent=2, sort_keys=True)


def geocodificar(municipio, provincia):
    """Devuelve {"lat": float, "lng": float} o None si no se encuentra."""
    cache = _cargar_cache()
    clave = f"{municipio}|{provincia}"
    if clave in cache:
        return cache[clave]

    global _ultima_peticion
    espera = 1.1 - (time.time() - _ultima_peticion)
    if espera > 0:
        time.sleep(espera)

    params = urllib.parse.urlencode({
        "city": municipio,
        "county": provincia,
        "state": "Castilla-La Mancha",
        "country": "España",
        "format": "json",
        "limit": 1,
    })
    req = urllib.request.Request(f"{NOMINATIM_URL}?{params}", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resultados = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  [geo] Error consultando '{clave}': {e}")
        return None
    finally:
        _ultima_peticion = time.time()

    if not resultados:
        # Segundo intento más laxo (p. ej. pedanías o nombres compuestos)
        params = urllib.parse.urlencode({
            "q": f"{municipio}, {provincia}, España",
            "format": "json",
            "limit": 1,
        })
        time.sleep(1.1)
        req = urllib.request.Request(f"{NOMINATIM_URL}?{params}", headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                resultados = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"  [geo] Error consultando '{clave}': {e}")
            return None
        finally:
            _ultima_peticion = time.time()

    if not resultados:
        cache[clave] = None
        return None

    coords = {"lat": round(float(resultados[0]["lat"]), 5), "lng": round(float(resultados[0]["lon"]), 5)}
    cache[clave] = coords
    return coords
