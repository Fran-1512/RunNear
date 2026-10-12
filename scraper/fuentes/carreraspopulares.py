"""
Adaptador para carreraspopulares.com (calendario de toda España).

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
LISTA = URL_BASE + "/calendario_carreras/lista/CuVPow/carreras_espa%C3%B1a_proximos_30_dias"
MAX_PAGINAS = 250


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
            continue  # fuera de España
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
    """Lista "carreras España próximos 30 días" (la de /calendario_carreras no se puede paginar:
    siempre devuelve las mismas carreras)."""
    carreras, vistas = [], set()
    for pagina in range(1, MAX_PAGINAS + 1):
        h = descargar_permitido(LISTA + (f"?page={pagina}" if pagina > 1 else ""))
        if "fichaEdicion" not in h:
            break
        nuevas = [c for c in _fichas(h) if c["id"] not in vistas]
        if not nuevas:
            break  # página repetida: se ha llegado al final
        vistas.update(c["id"] for c in nuevas)
        carreras += nuevas
        if f"page={pagina + 1}" not in h:
            break
    return carreras
