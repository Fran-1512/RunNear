"""
Adaptador para carreraspopulares.com (calendario nacional; nos quedamos con las de
Castilla-La Mancha).

robots.txt: "Disallow:" vacío = todo permitido (revisado 2026-10-03).

Listado paginado /calendario_carreras?page=N. Cada ficha ("fichaEdicion"):
  <h4><a href="/carrera/<slug>">NOMBRE</a></h4>
  Domingo 11 octubre 2026 · Tejadillos (Cuenca) · 16Km desnivel+670m. ...
"""

import re

from ..comun import (descargar_permitido, distancias_por_nombre, extraer_desnivel, extraer_distancias_km,
                     fecha_texto, normalizar_provincia, texto_visible, tipo_por_nombre,
                     titulo_carrera, titulo_municipio)

NOMBRE = "carreraspopulares.com"
URL_BASE = "https://carreraspopulares.com"
MAX_PAGINAS = 12


def _fichas(h):
    carreras = []
    for bloque in re.split(r'(?=<div class="fichaEdicion)', h)[1:]:
        enlace = re.search(r'<h4>\s*<a href="(https://carreraspopulares\.com/carrera/([^"]+))"[^>]*>(.*?)</a>', bloque, flags=re.S)
        if not enlace:
            continue
        info = re.search(r'<p>(.*?)</p>', bloque[enlace.end():], flags=re.S)
        lineas = [texto_visible(x) for x in re.split(r"</br>|<br\s*/?>", info.group(1))] if info else []
        lineas = [x for x in lineas if x]
        fecha = fecha_texto(lineas[0]) if lineas else None
        lugar = re.match(r"(.+?)\s*\((.+?)\)\s*$", lineas[1]) if len(lineas) > 1 else None
        if not fecha or not lugar:
            continue
        provincia = normalizar_provincia(lugar.group(2))
        if not provincia:
            continue  # fuera de Castilla-La Mancha
        nombre = titulo_carrera(texto_visible(enlace.group(3)))
        detalle = " ".join(lineas[2:])
        distancias = extraer_distancias_km(detalle) or distancias_por_nombre(nombre)
        carrera = {
            "id": f"cp-{enlace.group(2)}",
            "nombre": nombre,
            "tipo": tipo_por_nombre(nombre, detalle),
            "fecha": fecha,
            "municipio": titulo_municipio(lugar.group(1)),
            "provincia": provincia,
            "distancia_km": max(distancias) if distancias else None,
            "distancias_km": distancias,
            "url_oficial": enlace.group(1),
            "fuente": {"nombre": NOMBRE, "url": URL_BASE},
        }
        desnivel = extraer_desnivel(detalle)
        if desnivel and carrera["tipo"] == "trail":
            carrera["desnivel_positivo_m"] = desnivel
        carreras.append(carrera)
    return carreras


def obtener_carreras():
    carreras = []
    for pagina in range(1, MAX_PAGINAS + 1):
        url = f"{URL_BASE}/calendario_carreras" + (f"?page={pagina}" if pagina > 1 else "")
        h = descargar_permitido(url)
        if "fichaEdicion" not in h:
            break
        carreras += _fichas(h)
        if f"page={pagina + 1}" not in h:
            break
    return carreras
