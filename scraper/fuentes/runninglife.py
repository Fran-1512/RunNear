"""
Adaptador para Running.life (calendario de toda España).

robots.txt: solo prohíbe las páginas /xx/map/ (revisado 2026-10-03).

El listado /running-calendar/spain?page=N incluye un JSON-LD "ItemList" de
"SportsEvent" con nombre, fecha, municipio y COORDENADAS exactas. No trae la
provincia (se calcula con las coordenadas) ni la web oficial: esa se lee de la
ficha del evento, solo para las carreras que no estén ya en otra fuente, y se
recuerda 30 días (scraper/runninglife_webs.json) para no repetir la consulta.
"""

import json
import os
import re
from datetime import date, timedelta

from ..comun import (descargar_permitido, distancias_por_nombre, extraer_distancias_km,
                     provincia_por_punto, tipo_por_nombre)

NOMBRE = "Running.life"
URL_BASE = "https://running.life"
LISTADO = URL_BASE + "/running-calendar/spain"
MAX_PAGINAS = 150
CACHE_WEBS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "runninglife_webs.json")
DIAS_CACHE_WEBS = 30
# Webs que no son la de la carrera (redes del propio Running.life, etc.)
NO_OFICIALES = ("running.life", "walking.life", "gotrail.run", "facebook.com/runninglife", "instagram.com/running")


def _eventos(h):
    for bloque in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', h, flags=re.S):
        try:
            datos = json.loads(bloque)
        except ValueError:
            continue
        if isinstance(datos, dict) and datos.get("@type") == "ItemList":
            for elemento in datos.get("itemListElement", []):
                yield elemento.get("item", {})


def obtener_carreras():
    carreras = []
    for pagina in range(1, MAX_PAGINAS + 1):
        h = descargar_permitido(LISTADO + (f"?page={pagina}" if pagina > 1 else ""))
        eventos = list(_eventos(h))
        for e in eventos:
            geo = (e.get("location") or {}).get("geo") or {}
            direccion = (e.get("location") or {}).get("address") or {}
            lat, lng = geo.get("latitude"), geo.get("longitude")
            if lat is None or lng is None:
                continue
            provincia = provincia_por_punto(float(lat), float(lng))
            if not provincia:
                continue
            nombre = (e.get("name") or "").strip()
            descripcion = e.get("description") or ""
            distancias = extraer_distancias_km(descripcion) or distancias_por_nombre(nombre)
            slug = (e.get("url") or "").rstrip("/").rsplit("/", 1)[-1]
            carreras.append({
                "id": f"rl-{slug}",
                "nombre": nombre,
                "tipo": tipo_por_nombre(nombre),
                "fecha": (e.get("startDate") or "")[:10],
                "municipio": direccion.get("addressLocality") or (e.get("location") or {}).get("name", ""),
                "provincia": provincia,
                "ubicacion": {"lat": round(float(lat), 5), "lng": round(float(lng), 5)},
                "ubicacion_exacta": True,
                "distancia_km": max(distancias) if distancias else None,
                "distancias_km": distancias,
                "url_oficial": e.get("url", ""),
                "url_ficha_fuente": e.get("url", ""),
                "fuente": {"nombre": NOMBRE, "url": URL_BASE},
            })
        if not eventos or f"page={pagina + 1}" not in h:
            break
    return carreras


_cache_webs = None


def _cache():
    global _cache_webs
    if _cache_webs is None:
        try:
            with open(CACHE_WEBS, encoding="utf-8") as f:
                _cache_webs = json.load(f)
        except (OSError, ValueError):
            _cache_webs = {}
    return _cache_webs


def guardar_cache_webs():
    if _cache_webs is None:
        return
    limite = (date.today() - timedelta(days=DIAS_CACHE_WEBS * 3)).isoformat()
    vigentes = {k: v for k, v in _cache_webs.items() if v.get("consultado", "") >= limite}
    with open(CACHE_WEBS, "w", encoding="utf-8") as f:
        json.dump(vigentes, f, ensure_ascii=False, indent=1, sort_keys=True)


def completar_web_oficial(carrera):
    """Para carreras nuevas: busca en la ficha de Running.life el enlace a la web de la carrera
    (o lo toma de la memoria si se consultó hace menos de DIAS_CACHE_WEBS días)."""
    cache = _cache()
    clave = carrera["id"]
    limite = (date.today() - timedelta(days=DIAS_CACHE_WEBS)).isoformat()
    entrada = cache.get(clave)
    if not entrada or entrada.get("consultado", "") < limite:
        try:
            h = descargar_permitido(carrera["url_ficha_fuente"])
        except Exception:
            return
        externos = [u for u in re.findall(r'href="(https?://[^"]+)"', h)
                    if not any(x in u for x in NO_OFICIALES)]
        entrada = {"url": externos[0] if externos else None, "consultado": date.today().isoformat()}
        cache[clave] = entrada
    if entrada.get("url"):
        carrera["url_oficial"] = entrada["url"]
