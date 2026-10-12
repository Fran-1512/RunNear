"""
Adaptador para Runnea (calendarios de asfalto y trail de cada comunidad de España).

robots.txt: permite el calendario de carreras (solo prohíbe fichas de productos;
revisado 2026-10-03).

Cada carrera del listado viene en un JSON-LD de tipo "Event". Cada comunidad tiene
su calendario (/carreras-populares/calendario/<comunidad>/), con páginas /2/, /3/...
"""

import json
import re

from ..comun import (descargar_permitido, distancias_por_nombre, fecha_ddmmaaaa, normalizar,
                     normalizar_provincia, tipo_por_nombre)

NOMBRE = "Runnea"
URL_BASE = "https://www.runnea.com"
COMUNIDADES = ["andalucia", "aragon", "asturias", "baleares", "canarias", "cantabria", "castilla-la-mancha",
               "castilla-leon", "catalunya", "comunidad-valenciana", "euskadi", "extremadura", "galicia",
               "la-rioja", "madrid", "murcia", "navarra"]
LISTADOS = ([f"{URL_BASE}/carreras-populares/calendario/{c}/" for c in COMUNIDADES]
            + [f"{URL_BASE}/carreras-populares/calendario/trail/{c}/" for c in COMUNIDADES])
MAX_PAGINAS = 10


def _paginas(url):
    """HTML de cada página del listado, mientras siga habiendo carreras."""
    for pagina in range(1, MAX_PAGINAS + 1):
        try:
            h = descargar_permitido(url if pagina == 1 else f"{url}{pagina}/")
        except Exception as e:
            if pagina == 1:
                print(f"  [{NOMBRE}] {url}: {e}")
            return
        if '"Event"' not in h:
            return
        yield h
        if f"/{pagina + 1}/" not in h:
            return


def obtener_carreras():
    carreras = {}
    for url in LISTADOS:
        for h in _paginas(url):
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
