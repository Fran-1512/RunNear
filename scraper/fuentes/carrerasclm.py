"""
Adaptador para https://carrerasclm.es (calendario de Castilla-La Mancha).

robots.txt: "User-agent: * / Allow: /" (revisado 2026-09-29).

La web es Next.js y envía todas las carreras en el payload RSC de la página
(self.__next_f.push(...)) dentro de un array "initialEvents". Cada evento trae:
id, title, location, provincia (AB/CR/CU/GU/TO), typeId, distances,
registrationUrl, fecha ("$D2026-02-07T00:00:00.000Z"), grupo (circuito).
Basta UNA petición para obtener el calendario completo.
"""

import json
import re

from ..comun import PROVINCIAS_CLM, descargar, extraer_distancias_km

NOMBRE = "Carreras CLM"
URL_BASE = "https://carrerasclm.es"

# Solo nos interesan carreras a pie
TIPOS = {"carrera": "popular", "trail": "trail"}


def _payload_rsc(html):
    """Une y decodifica los fragmentos self.__next_f.push([1,"..."])."""
    fragmentos = re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', html)
    return "".join(json.loads(f) for f in fragmentos)


def _eventos_iniciales(payload):
    """Localiza y parsea el array JSON que sigue a "initialEvents":"""
    marca = '"initialEvents":'
    i = payload.find(marca)
    if i < 0:
        raise ValueError("No se encontró 'initialEvents' en la página: ¿ha cambiado la web?")
    eventos, _ = json.JSONDecoder().raw_decode(payload, i + len(marca))
    return eventos


def obtener_carreras():
    html = descargar(URL_BASE + "/")
    eventos = _eventos_iniciales(_payload_rsc(html))

    carreras = []
    for ev in eventos:
        tipo = TIPOS.get(ev.get("typeId"))
        if not tipo:
            continue  # ciclismo, duatlón, triatlón...

        fecha = (ev.get("fecha") or "").removeprefix("$D")[:10]
        distancias = extraer_distancias_km(ev.get("distances"))

        carreras.append({
            "id": f"clm-{ev['id']}",
            "nombre": (ev.get("title") or "").strip(),
            "tipo": tipo,
            "fecha": fecha,
            "municipio": (ev.get("location") or "").strip(),
            "provincia": PROVINCIAS_CLM.get(ev.get("provincia"), ev.get("provincia") or ""),
            "distancia_km": max(distancias) if distancias else None,
            "distancias_km": distancias,
            "url_oficial": ev.get("registrationUrl") or "",
            "circuito": ev.get("grupo") or None,
            "fuente": {"nombre": NOMBRE, "url": URL_BASE},
        })
    return carreras
