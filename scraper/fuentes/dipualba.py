"""
Adaptador para Deportes Dipualba (Diputación de Albacete): pruebas de sus circuitos
provinciales de carreras populares y de trail.

robots.txt: "Allow: /" (revisado 2026-10-03).

Listados paginados (?TipoPrueba=2 = pruebas pendientes de celebrar):
  /deportes/pruebas-carreras-populares   /deportes/pruebas-trail
Cada prueba: "NOMBRE  dd/mm/aaaa  MUNICIPIO  N km  Ver ficha" con enlace a /deportes/FichaPrueba/<id>
"""

import re

from ..comun import (descargar_permitido, extraer_distancias_km, fecha_ddmmaaaa,
                     texto_visible, titulo_carrera, titulo_municipio)

NOMBRE = "Dipualba"
URL_BASE = "https://deportes.dipualba.es"
LISTADOS = [
    ("/deportes/pruebas-carreras-populares", 2, "popular"),
    ("/deportes/pruebas-trail", 1, "trail"),
]
MAX_PAGINAS = 10


def _pruebas_de_pagina(h, tipo):
    """Trocea el HTML por fichas de prueba y extrae sus datos del texto de cada trozo."""
    pruebas = []
    trozos = re.split(r'(?=<a href="/deportes/FichaPrueba/\d+")', h)
    vistas = set()
    for trozo in trozos[1:]:
        ident = re.match(r'<a href="/deportes/FichaPrueba/(\d+)"', trozo).group(1)
        if ident in vistas:
            continue
        # El texto de la prueba llega hasta su botón "Ver ficha" (ojo: el atributo title
        # del propio enlace también contiene "Ver ficha de la prueba...")
        fin = re.search(r">\s*Ver ficha\s*<", trozo)
        texto = texto_visible(trozo[:fin.start() if fin else 3000])
        m = re.search(r"(.+?)\s+(\d{2}/\d{2}/\d{4})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*km", texto)
        if not m:
            continue
        vistas.add(ident)
        nombre = re.sub(r"^[¡!\s]*NUEVO RECORRIDO[!¡\s]*", "", m.group(1), flags=re.I).strip()
        estado = None
        if re.search(r"\(CANCELAD[AO]\)", nombre, flags=re.I):
            estado = "cancelada"
            nombre = re.sub(r"\s*\(CANCELAD[AO]\)\s*", " ", nombre, flags=re.I).strip()
        distancias = extraer_distancias_km(m.group(4) + " km")
        prueba = {
            "id": f"dip-{ident}",
            "nombre": titulo_carrera(nombre),
            "tipo": tipo,
            "fecha": fecha_ddmmaaaa(m.group(2)),
            "municipio": titulo_municipio(m.group(3)),
            "provincia": "Albacete",
            "distancia_km": max(distancias) if distancias else None,
            "distancias_km": distancias,
            "url_oficial": f"{URL_BASE}/deportes/FichaPrueba/{ident}",
            "fuente": {"nombre": NOMBRE, "url": URL_BASE},
        }
        if estado:
            prueba["estado"] = estado
        pruebas.append(prueba)
    return pruebas


def obtener_carreras():
    carreras = []
    for ruta, deporte_id, tipo in LISTADOS:
        for pagina in range(1, MAX_PAGINAS + 1):
            url = f"{URL_BASE}{ruta}?TipoPrueba=2&DeporteId={deporte_id}&page={pagina}"
            h = descargar_permitido(url)
            nuevas = _pruebas_de_pagina(h, tipo)
            carreras += nuevas
            # Última página: no hay enlace a la siguiente
            if not nuevas or f"page={pagina + 1}" not in h:
                break
    return carreras
