"""
Adaptador para Runnea (calendarios de Castilla-La Mancha: asfalto y trail).

robots.txt: permite el calendario de carreras (solo prohíbe fichas de productos;
revisado 2026-10-03).

Cada carrera del listado viene en un JSON-LD de tipo "Event".
"""

import json
import re

from ..comun import (descargar_permitido, distancias_por_nombre, fecha_ddmmaaaa, normalizar,
                     normalizar_provincia, tipo_por_nombre)

NOMBRE = "Runnea"
URL_BASE = "https://www.runnea.com"
LISTADOS = [
    URL_BASE + "/carreras-populares/calendario/castilla-la-mancha/",
    URL_BASE + "/carreras-populares/calendario/trail/castilla-la-mancha/",
]


def obtener_carreras():
    carreras = {}
    for url in LISTADOS:
        try:
            h = descargar_permitido(url)
        except Exception as e:
            print(f"  [{NOMBRE}] {url}: {e}")
            continue
        for bloque in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', h, flags=re.S):
            try:
                e = json.loads(bloque)
            except ValueError:
                continue
            if not isinstance(e, dict) or e.get("@type") != "Event":
                continue
            direccion = ((e.get("location") or {}).get("address") or {})
            provincia = normalizar_provincia(direccion.get("addressRegion") or direccion.get("addressLocality"))
            municipio = direccion.get("addressLocality") or ""
            if not provincia:
                continue
            nombre = (e.get("name") or "").strip()
            # Runnea añade el año al nombre ("Maratón de Toledo 2026")
            nombre = re.sub(r"\s+20\d\d$", "", nombre)
            # Sin municipio: si el nombre menciona la capital de la provincia, es esa
            if not municipio and normalizar(provincia) in normalizar(nombre):
                municipio = provincia
            if not municipio:
                continue
            distancias = distancias_por_nombre(nombre)
            enlace = e.get("url") or url
            carreras[normalizar(nombre)] = {
                "id": f"runnea-{normalizar(nombre).replace(' ', '-')}",
                "nombre": nombre,
                "tipo": "trail" if "/trail/" in url else tipo_por_nombre(nombre),
                "fecha": fecha_ddmmaaaa(e.get("startDate") or ""),
                "municipio": municipio,
                "provincia": provincia,
                "distancia_km": max(distancias) if distancias else None,
                "distancias_km": distancias,
                "url_oficial": enlace,
                "fuente": {"nombre": NOMBRE, "url": URL_BASE},
            }
    return [c for c in carreras.values() if c["fecha"]]
