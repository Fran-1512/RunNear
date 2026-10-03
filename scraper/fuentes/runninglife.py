"""
Adaptador para Running.life (calendario de Castilla-La Mancha).

robots.txt: solo prohíbe las páginas /xx/map/ (revisado 2026-10-03).

El listado /running-calendar/spain/castilla-la-mancha?page=N incluye un JSON-LD
"ItemList" de "SportsEvent" con nombre, fecha, municipio y COORDENADAS exactas.
No trae la provincia (se calcula con las coordenadas) ni la web oficial: esa se
lee de la ficha del evento, solo para las carreras que no estén ya en otra fuente.
"""

import json
import re

from ..comun import (descargar_permitido, distancias_por_nombre, extraer_distancias_km,
                     provincia_por_punto, tipo_por_nombre)

NOMBRE = "Running.life"
URL_BASE = "https://running.life"
LISTADO = URL_BASE + "/running-calendar/spain/castilla-la-mancha"
MAX_PAGINAS = 8
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


def completar_web_oficial(carrera):
    """Para carreras nuevas: busca en la ficha de Running.life el enlace a la web de la carrera."""
    try:
        h = descargar_permitido(carrera["url_ficha_fuente"])
    except Exception:
        return
    externos = [u for u in re.findall(r'href="(https?://[^"]+)"', h)
                if not any(x in u for x in NO_OFICIALES)]
    if externos:
        carrera["url_oficial"] = externos[0]
