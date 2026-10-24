"""
Memoria del generador entre una publicación y la siguiente (se guarda en sitio/datos/ y GitHub la
sube al repositorio cada día junto con las carreras):

  archivo.json  carreras ya celebradas que han salido de carreras.json. Su ficha sigue publicada
                (con sus resultados y "próxima edición por confirmar") en vez de dar error 404, y
                cuando la fuente publica la siguiente edición, ocupa la misma dirección.
  fechas.json   la fecha en que cambió de verdad el contenido de cada página. El sitemap le da a
                Google esa fecha, no la de hoy, para que se fíe de ella y revise primero lo que cambia.
"""

import hashlib
import json
import os
from datetime import date, timedelta

CARPETA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datos")
ARCHIVO = os.path.join(CARPETA, "archivo.json")
FECHAS = os.path.join(CARPETA, "fechas.json")

# Cuánto tiempo se conserva la ficha de una carrera pasada (más de un año: así enlaza con la
# siguiente edición, que suele ser por las mismas fechas)
DIAS_ARCHIVO = 400

# Datos de cada carrera que se guardan en el archivo (lo que muestra su ficha)
CAMPOS = ["id", "nombre", "tipo", "fecha", "hora", "municipio", "provincia", "comunidad", "distancias_km",
          "distancia_km", "url_oficial", "circuito", "fuente", "fuentes", "ubicacion", "precio_desde",
          "desnivel_positivo_m", "resultados", "resultados_web", "inscritos", "plazas_max", "estado",
          "verificada_organizador", "descripcion"]


def _leer(ruta, por_defecto):
    try:
        with open(ruta, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return por_defecto


def _escribir(ruta, datos):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    temporal = ruta + ".tmp"
    with open(temporal, "w", encoding="utf-8", newline="\n") as f:
        json.dump(datos, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(temporal, ruta)


# ---------------------------------------------------------------------------
# Archivo de carreras celebradas
# ---------------------------------------------------------------------------

def cargar_archivo():
    """{ruta: carrera} de las carreras celebradas guardadas."""
    return _leer(ARCHIVO, {})


def actualizar_archivo(archivo, carreras, rutas, hoy):
    """Guarda en el archivo las carreras ya celebradas (con su dirección) y quita las que pasan de
    DIAS_ARCHIVO. Si una ruta ya tiene una edición guardada, se queda la más reciente."""
    limite = (date.fromisoformat(hoy) - timedelta(days=DIAS_ARCHIVO)).isoformat()
    for c in carreras:
        if c["fecha"] < hoy:
            ruta = rutas[c["id"]]
            previa = archivo.get(ruta)
            if not previa or previa["fecha"] <= c["fecha"]:
                archivo[ruta] = {k: c[k] for k in CAMPOS if c.get(k) not in (None, "", [])}
    for ruta in [r for r, c in archivo.items() if c["fecha"] < limite]:
        del archivo[ruta]
    return archivo


def guardar_archivo(archivo):
    _escribir(ARCHIVO, archivo)


# ---------------------------------------------------------------------------
# Fecha real de la última modificación de cada página
# ---------------------------------------------------------------------------

def huella(*partes):
    """Resumen corto del contenido que importa de una página (si cambia, la página ha cambiado)."""
    return hashlib.md5(json.dumps(partes, ensure_ascii=False, sort_keys=True, default=str)
                       .encode("utf-8")).hexdigest()[:12]


class Fechas:
    """fecha(ruta, huella) -> la fecha guardada si el contenido no ha cambiado; si ha cambiado (o es
    nueva), hoy. guardar() olvida las páginas que ya no existen."""

    def __init__(self, hoy):
        self.hoy = hoy
        self.previas = _leer(FECHAS, {})
        self.actuales = {}

    def fecha(self, ruta, huella_pagina):
        previa = self.previas.get(ruta)
        fecha = previa[1] if previa and previa[0] == huella_pagina else self.hoy
        self.actuales[ruta] = [huella_pagina, fecha]
        return fecha

    def guardar(self):
        _escribir(FECHAS, self.actuales)
