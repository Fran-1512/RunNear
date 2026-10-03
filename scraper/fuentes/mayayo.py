"""
Adaptador para "Carreras de Montaña, por Mayayo" (carrerasdemontana.com): su entrada
anual con el calendario de carreras por montaña de Castilla-La Mancha, que reproduce
el calendario oficial de la Federación (FDMCM): Copa y Campeonatos CxM.

robots.txt: "Disallow:" vacío = todo permitido (revisado 2026-10-03).

La entrada es TEXTO LIBRE, del estilo:
  "...el Desafío Cucón – Montes de Fuencaliente, en Fuencaliente (Ciudad Real),
   programado para el 18 de octubre. Serán 29 km y +1.700 m de desnivel."
Se lee frase a frase alrededor de cada fecha. Solo se acepta una carrera si se
encuentran nombre, fecha, municipio y provincia (mejor perder una que inventarla).
"""

import html
import json
import re
from datetime import date

from ..comun import descargar_permitido, extraer_desnivel, fecha_texto, normalizar

NOMBRE = "Carreras de Montaña por Mayayo (calendario FDMCM)"
URL_BASE = "https://carrerasdemontana.com"
API = URL_BASE + "/wp-json/wp/v2/"
PROVINCIAS = r"(Albacete|Ciudad Real|Cuenca|Guadalajara|Toledo)"
MAYUS = "A-ZÁÉÍÓÚÑ"
LUGAR = (rf"en (?:la localidad de |el municipio de )?([{MAYUS}][\w'’ ]+?)"
         rf"\s*(?:\(\s*{PROVINCIAS}\s*\)|,\s*(?:en\s+)?(?:la provincia de\s+)?{PROVINCIAS}\b)")
NOMBRE_PRUEBA = [
    r"[“\"]([^”\"]{4,90})[”\"]",                                                       # entre comillas
    rf"(?:la prueba|el turno del|el turno de la|con el|con la|llevará por nombre|denominación)\s+([{MAYUS}][^,.(]{{3,80}})",
    rf"(?:^|\.\s+)(?:La cuarta cita de la Copa será|La segunda prueba será|La tercera prueba será)\s+(?:el|la)\s+([{MAYUS}][^,.(]{{3,80}})",
]
FECHA = r"\b\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: de \d{4})?"


def _parrafos(contenido):
    for bloque in re.findall(r"<(?:p|li)[^>]*>(.*?)</(?:p|li)>", contenido, flags=re.S):
        t = html.unescape(re.sub(r"<[^>]+>", "", bloque)).replace("‑", "-").strip()
        if t:
            yield re.sub(r"\s+", " ", t)


def _frases(texto):
    """Frases con su posición de inicio."""
    inicio = 0
    for m in re.finditer(r"(?<=[.!?])\s+(?=[" + MAYUS + "¡¿])", texto):
        yield inicio, texto[inicio:m.start()]
        inicio = m.end()
    yield inicio, texto[inicio:]


def _carreras_de_parrafo(texto, anio):
    frases = list(_frases(texto))
    carreras = []
    for i, (_, frase) in enumerate(frases):
        for mf in re.finditer(FECHA, frase):
            fecha = fecha_texto(mf.group(0), anio)
            # Ventana: la frase de la fecha y, si no trae los kilómetros, la siguiente
            ventana = frase
            if not re.search(r"\d+\s*(?:km|kil[oó]metros)", frase) and i + 1 < len(frases) \
                    and not re.search(FECHA, frases[i + 1][1]):
                ventana += " " + frases[i + 1][1]

            lugar = re.search(LUGAR, ventana)
            nombre = None
            for patron in NOMBRE_PRUEBA:
                mn = re.search(patron, ventana)
                if mn:
                    # "Petaca Trail y se celebrará en..." -> "Petaca Trail"
                    nombre = re.split(r"\s+(?:y se|se celebrar|que se|en la localidad|en el municipio)\b", mn.group(1))[0]
                    nombre = nombre.strip(" –-")
                    break
            if not (fecha and lugar and nombre):
                continue
            municipio = lugar.group(1).strip()
            provincia = lugar.group(2) or lugar.group(3)
            km = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:km|kil[oó]metros)", ventana)
            distancia = float(km.group(1).replace(",", ".")) if km else None
            carrera = {
                "id": "may-" + normalizar(f"{fecha} {nombre}").replace(" ", "-")[:60],
                "nombre": nombre,
                "tipo": "trail",
                "fecha": fecha,
                "municipio": municipio,
                "provincia": provincia,
                "distancia_km": distancia,
                "distancias_km": [distancia] if distancia else [],
                "url_oficial": "",
                "circuito": "Copa y Campeonatos CxM Castilla-La Mancha",
                "fuente": {"nombre": NOMBRE, "url": URL_BASE},
            }
            desnivel = extraer_desnivel(ventana)
            if desnivel:
                carrera["desnivel_positivo_m"] = desnivel
            carreras.append(carrera)
    return carreras


def obtener_carreras():
    carreras = []
    anio_actual = date.today().year
    for anio in (anio_actual, anio_actual + 1):
        slug = f"calendario-carreras-montana-castilla-la-mancha-{anio}"
        categorias = json.loads(descargar_permitido(f"{API}categories?slug={slug}"))
        if not categorias:
            continue
        posts = json.loads(descargar_permitido(f"{API}posts?categories={categorias[0]['id']}&_fields=link,content"))
        for post in posts:
            for parrafo in _parrafos(post["content"]["rendered"]):
                for c in _carreras_de_parrafo(parrafo, anio):
                    c["url_oficial"] = post["link"]   # sin web oficial: se enlaza la reseña
                    carreras.append(c)
    return carreras
