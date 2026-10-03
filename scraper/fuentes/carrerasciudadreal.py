"""
Adaptador para el Circuito de Carreras de Ciudad Real (carrerasciudadreal.es).

robots.txt: permite el acceso (revisado 2026-10-03).

La web usa WordPress con el plugin "The Events Calendar", que ofrece los eventos en
JSON: /wp-json/tribe/events/v1/events (fecha y HORA de salida, lugar, enlace).
"""

import html
import json
from datetime import date

from ..comun import descargar_permitido, distancias_por_nombre, normalizar_provincia, tipo_por_nombre

NOMBRE = "Circuito Carreras Ciudad Real"
URL_BASE = "https://carrerasciudadreal.es"


def obtener_carreras():
    carreras = []
    pagina = 1
    while pagina <= 5:
        url = (f"{URL_BASE}/wp-json/tribe/events/v1/events?per_page=50&page={pagina}"
               f"&start_date={date.today().isoformat()}")
        datos = json.loads(descargar_permitido(url))
        for e in datos.get("events", []):
            lugar = e.get("venue") if isinstance(e.get("venue"), dict) else {}
            nombre = html.unescape(e.get("title", "")).strip()
            fecha_hora = e.get("start_date", "")  # "2026-10-04 11:30:00"
            hora = fecha_hora[11:16] if len(fecha_hora) >= 16 and fecha_hora[11:16] != "00:00" else None
            distancias = distancias_por_nombre(nombre)
            carrera = {
                "id": f"ccr-{e['id']}",
                "nombre": nombre,
                "tipo": tipo_por_nombre(nombre),
                "fecha": fecha_hora[:10],
                "municipio": (lugar.get("city") or "").strip(),
                "provincia": normalizar_provincia(lugar.get("province") or lugar.get("state")) or "Ciudad Real",
                "distancia_km": max(distancias) if distancias else None,
                "distancias_km": distancias,
                "url_oficial": e.get("url", ""),
                # Mismo nombre que usa Carreras CLM, para que el menú no muestre el circuito dos veces
                "circuito": f"Circuito Carreras Populares Ciudad Real {fecha_hora[:4]}",
                "fuente": {"nombre": NOMBRE, "url": URL_BASE},
            }
            if hora:
                carrera["hora"] = hora
            carreras.append(carrera)
        if pagina >= int(datos.get("total_pages") or 1):
            break
        pagina += 1
    return carreras
