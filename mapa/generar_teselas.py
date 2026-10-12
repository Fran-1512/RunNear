#!/usr/bin/env python3
"""
Genera el mapa PROPIO de RunNear para toda España (teselas vectoriales) a partir de los
extractos de OpenStreetMap de Geofabrik, comunidad a comunidad.

Para que ocupe lo mínimo:
  - Mapa base de toda España (zoom 8-13): pueblos, carreteras, calles a vista general,
    ríos, embalses, bosques, cascos urbanos, límites y picos.
  - Detalle completo (zoom 14-18: todas las calles, caminos, senderos, parques...) solo en
    "bloques" de ~30 x 30 km (teselas de nivel 10) donde hay carreras. Fuera, al acercarse
    se amplía el mapa base.
  - Cada tesela se guarda comprimida (gzip, extensión .bin); el navegador la descomprime.
  - Las teselas de detalle se agrupan en paquetes de 4 x 4 (por tesela de nivel 12).

Resultado: mapa/teselas/
  l/{nivel}/{x}/{y}.bin       líneas y etiquetas del mapa base
  p/{nivel}/{x}/{y}.bin       polígonos del mapa base
  l/14/{x12}/{y12}.bin        paquete de detalle: {"dx_dy": tesela, ...}
  p/14/{x12}/{y12}.bin
  meta.json                   niveles, clases, bloques de detalle y qué teselas existen

Licencia de los datos: © OpenStreetMap contributors, ODbL (se cita en la esquina del mapa).

Uso (desde la carpeta del proyecto, solo cuando se quiera regenerar):
    py mapa/generar_teselas.py                      todo
    py mapa/generar_teselas.py --regiones madrid    solo esas comunidades (pruebas)
"""

import argparse
import base64
import gzip
import json
import math
import os
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shapefile_lector import leer_capa  # noqa: E402

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROYECTO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(PROYECTO, "mapa", "teselas")
CARPETA_DATOS = os.path.join(tempfile.gettempdir(), "runnear_osm")
CARPETA_TMP = os.path.join(tempfile.gettempdir(), "runnear_teselas_tmp")

GEOFABRIK = "https://download.geofabrik.de/"
REGIONES = {
    "andalucia": "europe/spain/andalucia", "aragon": "europe/spain/aragon",
    "asturias": "europe/spain/asturias", "cantabria": "europe/spain/cantabria",
    "castilla-la-mancha": "europe/spain/castilla-la-mancha", "castilla-y-leon": "europe/spain/castilla-y-leon",
    "cataluna": "europe/spain/cataluna", "ceuta": "europe/spain/ceuta",
    "extremadura": "europe/spain/extremadura", "galicia": "europe/spain/galicia",
    "islas-baleares": "europe/spain/islas-baleares", "la-rioja": "europe/spain/la-rioja",
    "madrid": "europe/spain/madrid", "melilla": "europe/spain/melilla",
    "murcia": "europe/spain/murcia", "navarra": "europe/spain/navarra",
    "pais-vasco": "europe/spain/pais-vasco", "valencia": "europe/spain/valencia",
    "canarias": "africa/canary-islands",
}

# (nivel de datos, zoom máximo que sirve). Un nivel se reutiliza ("sobrezoom") hasta su zoom máximo.
NIVELES_BASE = [(8, 9), (10, 11), (12, 13)]
NIVEL_DETALLE, ZMAX_DETALLE = 14, 18
# El detalle se guarda con la precisión del zoom 17 (no del 18): al ampliar del todo la
# diferencia es de ~1 píxel y el mapa ocupa bastante menos
RESOL_DETALLE = 17
TOL_PX_DETALLE = 1.0
NIVEL_BLOQUE = 10    # zonas de detalle: teselas de nivel 10 (~30 km)
NIVEL_PAQUETE = 12   # el detalle se agrupa por tesela de nivel 12
ZOOM_MAX = 18
ZOOMS_ETIQUETAS = range(8, ZOOM_MAX + 1)
TOL_PX = 0.8           # tolerancia de simplificación, en píxeles al zoom máximo del nivel
BUFFER_POLIGONO = 0.02  # solape entre teselas vecinas (fracción de tesela) para evitar costuras
MARGEN_BLOQUE = 0.15   # si una carrera está a menos de este margen del borde, se añade el bloque vecino


def extension(nivel, zmax):
    """Resolución de coordenadas de la tesela: ~1 unidad por píxel a su zoom máximo."""
    return min(8192, 256 * 2 ** (zmax - nivel))


# ---------------------------------------------------------------------------
# Clases: nombre -> zoom mínimo al que se dibuja
# ---------------------------------------------------------------------------

CLASES_L = [  # el orden es también el orden de dibujo (de abajo a arriba)
    "limite_municipal", "limite_provincial",
    "acequia", "arroyo", "canal", "rio",
    "ferrocarril",
    "escaleras", "sendero", "pista", "servicio", "peatonal", "calle",
    "sin_clasificar", "terciaria", "secundaria", "primaria", "enlace", "nacional", "autovia",
]
CLASES_P = ["cantera", "frutal", "vinedo", "matorral", "bosque", "parque", "cementerio",
            "industrial", "urbano", "humedal", "agua"]
CLASES_T = ["ciudad", "villa", "pueblo", "barrio", "aldea", "paraje", "pico"]

# Tamaño de letra de cada tipo de etiqueta (el renderizador usa los mismos valores)
FUENTE_T = {"ciudad": 15, "villa": 13, "pueblo": 12, "barrio": 11, "aldea": 11, "paraje": 10, "pico": 10}
MINZ_T = {"ciudad": 8, "villa": 9, "pueblo": 10, "barrio": 13, "aldea": 12, "paraje": 15, "pico": 12}
RANGO_T = {"ciudad": 0, "villa": 1, "pueblo": 2, "barrio": 3, "aldea": 4, "pico": 5, "paraje": 6}

VIAS = {
    "motorway": ("autovia", 8), "trunk": ("nacional", 8), "primary": ("primaria", 8),
    "secondary": ("secundaria", 9), "tertiary": ("terciaria", 10),
    "motorway_link": ("enlace", 11), "trunk_link": ("enlace", 11),
    "primary_link": ("primaria", 12), "secondary_link": ("secundaria", 12), "tertiary_link": ("terciaria", 13),
    "unclassified": ("sin_clasificar", 11), "residential": ("calle", 12), "living_street": ("calle", 13),
    "road": ("calle", 13), "pedestrian": ("peatonal", 14), "service": ("servicio", 14), "busway": ("servicio", 14),
    "track": ("pista", 13), "track_grade1": ("pista", 13), "track_grade2": ("pista", 13),
    "track_grade3": ("pista", 13), "track_grade4": ("pista", 13), "track_grade5": ("pista", 13),
    "path": ("sendero", 14), "footway": ("sendero", 14), "bridleway": ("sendero", 14),
    "cycleway": ("sendero", 14), "steps": ("escaleras", 15),
}
CURSOS_AGUA = {"river": ("rio", 9), "canal": ("canal", 11), "stream": ("arroyo", 13), "drain": ("acequia", 14)}
USOS_SUELO = {
    "forest": ("bosque", 10), "scrub": ("matorral", 11), "heath": ("matorral", 11),
    "residential": ("urbano", 10), "industrial": ("industrial", 12), "retail": ("industrial", 12),
    "commercial": ("industrial", 12), "park": ("parque", 13), "recreation_ground": ("parque", 13),
    "grass": ("parque", 14), "allotments": ("parque", 14), "cemetery": ("cementerio", 14),
    "vineyard": ("vinedo", 12), "orchard": ("frutal", 12), "quarry": ("cantera", 13), "landfill": ("cantera", 13),
}
LUGARES = {"city": "ciudad", "town": "villa", "village": "pueblo", "suburb": "barrio",
           "hamlet": "aldea", "locality": "paraje"}


# ---------------------------------------------------------------------------
# Geometría
# ---------------------------------------------------------------------------

def proyectar(coords):
    """array('d') [lon, lat, ...] -> lista [x, y, ...] en Mercator normalizado (0..1)."""
    salida = []
    log, sin, rad, pi4 = math.log, math.sin, math.radians, 4 * math.pi
    for i in range(0, len(coords), 2):
        s = sin(rad(coords[i + 1]))
        salida.append((coords[i] + 180.0) / 360.0)
        salida.append(0.5 - log((1 + s) / (1 - s)) / pi4)
    return salida


def simplificar(pts, tol):
    """Distancia radial + Douglas-Peucker iterativo sobre lista plana [x, y, ...]."""
    n = len(pts) // 2
    if n <= 2:
        return pts
    tol2 = tol * tol

    # 1) Distancia radial: quita puntos casi pegados al anterior (muy rápido)
    reducido = [pts[0], pts[1]]
    lx, ly = pts[0], pts[1]
    for i in range(2, len(pts) - 2, 2):
        x, y = pts[i], pts[i + 1]
        if (x - lx) ** 2 + (y - ly) ** 2 > tol2:
            reducido.append(x)
            reducido.append(y)
            lx, ly = x, y
    reducido.append(pts[-2])
    reducido.append(pts[-1])
    pts = reducido
    n = len(pts) // 2
    if n <= 2:
        return pts

    # 2) Douglas-Peucker (distancia a segmento, válido también para anillos cerrados)
    conservar = bytearray(n)
    conservar[0] = conservar[n - 1] = 1
    pila = [(0, n - 1)]
    while pila:
        a, b = pila.pop()
        ax, ay = pts[2 * a], pts[2 * a + 1]
        dx, dy = pts[2 * b] - ax, pts[2 * b + 1] - ay
        dd = dx * dx + dy * dy
        max_d, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[2 * i] - ax, pts[2 * i + 1] - ay
            if dd > 0:
                t = (px * dx + py * dy) / dd
                if t < 0:
                    d = px * px + py * py
                elif t > 1:
                    ex, ey = px - dx, py - dy
                    d = ex * ex + ey * ey
                else:
                    cx, cy = px - t * dx, py - t * dy
                    d = cx * cx + cy * cy
            else:
                d = px * px + py * py
            if d > max_d:
                max_d, idx = d, i
        if max_d > tol2:
            conservar[idx] = 1
            pila.append((a, idx))
            pila.append((idx, b))
    salida = []
    for i in range(n):
        if conservar[i]:
            salida.append(pts[2 * i])
            salida.append(pts[2 * i + 1])
    return salida


def partir_linea(pts, escala):
    """
    Corta una polilínea (Mercator normalizado) por la rejilla de teselas del nivel.
    Devuelve {(tx, ty): [tramo, ...]} con cada tramo en unidades de tesela (floats).
    """
    floor = math.floor
    tramos = defaultdict(list)
    actual, tesela_actual = None, None

    def anadir(x0, y0, x1, y1, tesela):
        nonlocal actual, tesela_actual
        if tesela != tesela_actual:
            actual = [x0, y0]
            tramos[tesela].append(actual)
            tesela_actual = tesela
        actual.append(x1)
        actual.append(y1)

    x0, y0 = pts[0] * escala, pts[1] * escala
    for i in range(2, len(pts), 2):
        x1, y1 = pts[i] * escala, pts[i + 1] * escala
        tx0, ty0, tx1, ty1 = floor(x0), floor(y0), floor(x1), floor(y1)
        if tx0 == tx1 and ty0 == ty1:
            anadir(x0, y0, x1, y1, (tx0, ty0))
        else:
            # Parámetros t donde el segmento cruza líneas de la rejilla
            ts = []
            if tx0 != tx1:
                for gx in range(min(tx0, tx1) + 1, max(tx0, tx1) + 1):
                    ts.append((gx - x0) / (x1 - x0))
            if ty0 != ty1:
                for gy in range(min(ty0, ty1) + 1, max(ty0, ty1) + 1):
                    ts.append((gy - y0) / (y1 - y0))
            ts.sort()
            px, py = x0, y0
            for t in ts + [1.0]:
                qx, qy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                if qx != px or qy != py:
                    anadir(px, py, qx, qy, (floor((px + qx) / 2), floor((py + qy) / 2)))
                px, py = qx, qy
        x0, y0 = x1, y1
    return tramos


def recortar_anillo(anillo, xmin, ymin, xmax, ymax):
    """Sutherland-Hodgman de un anillo (lista plana) contra un rectángulo."""
    def recortar(puntos, dentro, cortar):
        salida = []
        n = len(puntos) // 2
        if n == 0:
            return salida
        sx, sy = puntos[-2], puntos[-1]
        for i in range(n):
            ex, ey = puntos[2 * i], puntos[2 * i + 1]
            if dentro(ex, ey):
                if not dentro(sx, sy):
                    salida.extend(cortar(sx, sy, ex, ey))
                salida.append(ex)
                salida.append(ey)
            elif dentro(sx, sy):
                salida.extend(cortar(sx, sy, ex, ey))
            sx, sy = ex, ey
        return salida

    def corte_x(xc):
        return lambda sx, sy, ex, ey: (xc, sy + (ey - sy) * (xc - sx) / (ex - sx))

    def corte_y(yc):
        return lambda sx, sy, ex, ey: (sx + (ex - sx) * (yc - sy) / (ey - sy), yc)

    p = recortar(anillo, lambda x, y: x >= xmin, corte_x(xmin))
    p = recortar(p, lambda x, y: x <= xmax, corte_x(xmax))
    p = recortar(p, lambda x, y: y >= ymin, corte_y(ymin))
    p = recortar(p, lambda x, y: y <= ymax, corte_y(ymax))
    return p


def _caja(anillos):
    xs = [v for a in anillos for v in a[0::2]]
    ys = [v for a in anillos for v in a[1::2]]
    return min(xs), min(ys), max(xs), max(ys)


def partir_poligono(anillos, escala, admitir=None):
    """
    Reparte un polígono (anillos en Mercator normalizado) entre las teselas del nivel,
    recortando por mitades recursivamente (coste ~ puntos x log(teselas)).
    admitir(x0, y0, x1, y1): si se da, descarta pronto zonas sin interés (detalle).
    Devuelve {(tx, ty): [anillo, ...]} en unidades de tesela.
    """
    anillos = [[v * escala for v in a] for a in anillos]
    resultado = {}
    b = BUFFER_POLIGONO

    def recursivo(anillos, x0, y0, x1, y1):
        # Ajustar el rango de teselas a la caja real de lo que queda
        cx0, cy0, cx1, cy1 = _caja(anillos)
        x0, y0 = max(x0, math.floor(cx0)), max(y0, math.floor(cy0))
        x1, y1 = min(x1, math.floor(cx1) + 1), min(y1, math.floor(cy1) + 1)
        if x1 <= x0 or y1 <= y0:
            return
        if admitir and not admitir(x0, y0, x1, y1):
            return
        if x1 - x0 == 1 and y1 - y0 == 1:
            resultado[(x0, y0)] = anillos
            return
        if x1 - x0 >= y1 - y0:
            m = (x0 + x1) // 2
            mitades = [(x0, y0, m, y1), (m, y0, x1, y1)]
        else:
            m = (y0 + y1) // 2
            mitades = [(x0, y0, x1, m), (x0, m, x1, y1)]
        for hx0, hy0, hx1, hy1 in mitades:
            recortados = [recortar_anillo(a, hx0 - b, hy0 - b, hx1 + b, hy1 + b) for a in anillos]
            recortados = [a for a in recortados if len(a) >= 6]
            if recortados:
                recursivo(recortados, hx0, hy0, hx1, hy1)

    cx0, cy0, cx1, cy1 = _caja(anillos)
    recursivo(anillos, math.floor(cx0), math.floor(cy0), math.floor(cx1) + 1, math.floor(cy1) + 1)
    return resultado


def codificar(tramo, tx, ty, ext, cerrado=False):
    """Tramo en unidades de tesela -> lista de enteros locales con deltas."""
    salida = []
    px = py = None
    for i in range(0, len(tramo), 2):
        u = round((tramo[i] - tx) * ext)
        v = round((tramo[i + 1] - ty) * ext)
        if px is None:
            salida.append(u)
            salida.append(v)
        elif u != px or v != py:
            salida.append(u - px)
            salida.append(v - py)
        else:
            continue
        px, py = u, v
    minimo = 6 if cerrado else 4
    return salida if len(salida) >= minimo else None


# ---------------------------------------------------------------------------
# Zonas de detalle (bloques de nivel 10 con carreras)
# ---------------------------------------------------------------------------

class Bloques:
    """Conjunto de teselas de nivel NIVEL_BLOQUE con detalle."""

    def __init__(self, claves):
        self.claves = set(claves)

    def contiene(self, tx, ty, nivel):
        k = nivel - NIVEL_BLOQUE
        return (tx >> k, ty >> k) in self.claves

    def toca(self, x0, y0, x1, y1, nivel):
        """¿El rango de teselas [x0, x1) x [y0, y1) del nivel toca algún bloque?"""
        k = nivel - NIVEL_BLOQUE
        bx0, by0, bx1, by1 = x0 >> k, y0 >> k, (x1 - 1) >> k, (y1 - 1) >> k
        if (bx1 - bx0 + 1) * (by1 - by0 + 1) > len(self.claves):
            return any(bx0 <= bx <= bx1 and by0 <= by <= by1 for bx, by in self.claves)
        return any((bx, by) in self.claves for bx in range(bx0, bx1 + 1) for by in range(by0, by1 + 1))


def bloques_de_carreras(extra=()):
    """Bloques con alguna carrera de carreras.json (y sus vecinos si está cerca del borde).
    extra: puntos (lat, lng) adicionales donde se quiere detalle."""
    with open(os.path.join(PROYECTO, "carreras.json"), encoding="utf-8") as f:
        carreras = json.load(f)
    puntos_detalle = [(c["ubicacion"]["lat"], c["ubicacion"]["lng"]) for c in carreras
                      if (c.get("ubicacion") or {}).get("lat") is not None and c["ubicacion"].get("lng") is not None]
    puntos_detalle += list(extra)
    escala = 2 ** NIVEL_BLOQUE
    claves = set()
    for lat, lng in puntos_detalle:
        x, y = proyectar([lng, lat])
        fx, fy = x * escala, y * escala
        tx, ty = math.floor(fx), math.floor(fy)
        dxs = [0] + ([-1] if fx - tx < MARGEN_BLOQUE else []) + ([1] if fx - tx > 1 - MARGEN_BLOQUE else [])
        dys = [0] + ([-1] if fy - ty < MARGEN_BLOQUE else []) + ([1] if fy - ty > 1 - MARGEN_BLOQUE else [])
        for dx in dxs:
            for dy in dys:
                claves.add((tx + dx, ty + dy))
    return claves


# ---------------------------------------------------------------------------
# Datos de Geofabrik
# ---------------------------------------------------------------------------

def carpeta_region(region):
    return os.path.join(CARPETA_DATOS, region)


def ruta_capa(region, nombre):
    return os.path.join(carpeta_region(region), "shp", f"gis_osm_{nombre}_free_1")


def asegurar_datos(region):
    if os.path.exists(ruta_capa(region, "roads") + ".shp"):
        return
    carpeta = carpeta_region(region)
    os.makedirs(carpeta, exist_ok=True)
    zip_path = os.path.join(carpeta, "free.shp.zip")
    if not os.path.exists(zip_path):
        url = f"{GEOFABRIK}{REGIONES[region]}-latest-free.shp.zip"
        parcial = zip_path + ".parcial"
        # Geofabrik a veces responde 502 durante un rato: se reintenta con esperas crecientes
        for intento in range(1, 6):
            print(f"  descargando {url} (intento {intento})...")
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "RunNear/0.2 (mapa propio; runnear.app@gmail.com)"})
                with urllib.request.urlopen(req, timeout=1200) as r, open(parcial, "wb") as f:
                    shutil.copyfileobj(r, f)
                os.replace(parcial, zip_path)
                break
            except Exception as e:
                print(f"  fallo: {e}")
                if intento == 5:
                    raise
                time.sleep(60 * intento)
    print("  descomprimiendo...")
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(os.path.join(carpeta, "shp"))


# ---------------------------------------------------------------------------
# Lectura de capas (generadores de features ya clasificadas)
# ---------------------------------------------------------------------------

def lineas(region):
    """(clase, minz, nombre, ref, flags, partes)"""
    for _, partes, a in leer_capa(ruta_capa(region, "roads"), ["fclass", "name", "ref", "bridge", "tunnel"]):
        clase = VIAS.get(a["fclass"])
        if clase:
            flags = (1 if a.get("tunnel") == "T" else 0) | (2 if a.get("bridge") == "T" else 0)
            yield clase[0], clase[1], a.get("name", ""), a.get("ref", ""), flags, partes
    for _, partes, a in leer_capa(ruta_capa(region, "waterways"), ["fclass", "name"]):
        clase = CURSOS_AGUA.get(a["fclass"])
        if clase:
            yield clase[0], clase[1], a.get("name", ""), "", 0, partes
    for _, partes, a in leer_capa(ruta_capa(region, "railways"), ["fclass", "tunnel"]):
        yield "ferrocarril", 9, "", "", (1 if a.get("tunnel") == "T" else 0), partes
    for _, partes, a in leer_capa(ruta_capa(region, "adminareas_a"), ["fclass"]):
        if a["fclass"] == "admin_level8":
            yield "limite_municipal", 11, "", "", 0, partes
        elif a["fclass"] == "admin_level6":
            yield "limite_provincial", 8, "", "", 0, partes


def poligonos(region):
    """(clase, minz_clase, partes)"""
    for _, partes, a in leer_capa(ruta_capa(region, "water_a"), ["fclass"]):
        fc = a["fclass"]
        if fc in ("water", "reservoir", "riverbank"):
            yield "agua", 8, partes
        elif fc.startswith("wetland"):
            yield "humedal", 12, partes
    for _, partes, a in leer_capa(ruta_capa(region, "landuse_a"), ["fclass"]):
        clase = USOS_SUELO.get(a["fclass"])
        if clase:
            yield clase[0], clase[1], partes


def puntos(region):
    """Lista de dicts: clase, nombre, x, y, prioridad"""
    lista = []
    for _, (lon, lat), a in leer_capa(ruta_capa(region, "places"), ["fclass", "name", "population"]):
        clase = LUGARES.get(a["fclass"])
        if clase and a.get("name"):
            x, y = proyectar([lon, lat])
            lista.append({"clase": clase, "nombre": a["name"], "x": x, "y": y,
                          "prioridad": (RANGO_T[clase], -(a.get("population") or 0))})
    for _, (lon, lat), a in leer_capa(ruta_capa(region, "natural"), ["fclass", "name"]):
        if a["fclass"] == "peak" and a.get("name"):
            x, y = proyectar([lon, lat])
            lista.append({"clase": "pico", "nombre": a["name"], "x": x, "y": y,
                          "prioridad": (RANGO_T["pico"], 0)})
    return lista


# ---------------------------------------------------------------------------
# Teselas en memoria y en disco
# ---------------------------------------------------------------------------

class Tesela:
    __slots__ = ("nombres", "features")

    def __init__(self):
        self.nombres = {}
        self.features = []

    def indice(self, texto):
        if not texto:
            return -1
        if texto not in self.nombres:
            self.nombres[texto] = len(self.nombres)
        return self.nombres[texto]

    def a_json(self):
        return {"n": list(self.nombres), "f": self.features}


def escribir_tmp(teselas, carpeta, capa, nivel):
    for (tx, ty), t in teselas.items():
        destino = os.path.join(carpeta, capa, str(nivel), str(tx))
        os.makedirs(destino, exist_ok=True)
        with open(os.path.join(destino, f"{ty}.json"), "w", encoding="utf-8") as f:
            json.dump(t.a_json(), f, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Generación de una comunidad (sin etiquetas: van aparte para toda España)
# ---------------------------------------------------------------------------

def generar_lineas(region, nivel, zmax, bloques, carpeta):
    ext = extension(nivel, zmax)
    escala = 2 ** nivel
    tol = (TOL_PX_DETALLE if nivel == NIVEL_DETALLE else TOL_PX) / (256 * 2 ** zmax)
    teselas = defaultdict(Tesela)
    id_clase = {c: i for i, c in enumerate(CLASES_L)}
    detalle = bloques is not None
    for clase, minz, nombre, ref, flags, partes in lineas(region):
        if minz > zmax:
            continue
        for parte in partes:
            pts = proyectar(parte)
            if detalle:
                xs, ys = pts[0::2], pts[1::2]
                if not bloques.toca(math.floor(min(xs) * escala), math.floor(min(ys) * escala),
                                    math.floor(max(xs) * escala) + 1, math.floor(max(ys) * escala) + 1, nivel):
                    continue
            pts = simplificar(pts, tol)
            if len(pts) < 4:
                continue
            for (tx, ty), tramos in partir_linea(pts, escala).items():
                if detalle and not bloques.contiene(tx, ty, nivel):
                    continue
                t = teselas[(tx, ty)]
                for tramo in tramos:
                    coords = codificar(tramo, tx, ty, ext)
                    if coords is not None:
                        t.features.append([id_clase[clase], minz, t.indice(nombre), t.indice(ref), flags, coords])
    escribir_tmp(teselas, carpeta, "l", nivel)
    return len(teselas)


def generar_poligonos(region, nivel, zmax, bloques, carpeta):
    ext = extension(nivel, zmax)
    escala = 2 ** nivel
    tol = (TOL_PX_DETALLE if nivel == NIVEL_DETALLE else TOL_PX) / (256 * 2 ** zmax)
    teselas = defaultdict(Tesela)
    id_clase = {c: i for i, c in enumerate(CLASES_P)}
    admitir = (lambda x0, y0, x1, y1: bloques.toca(x0, y0, x1, y1, nivel)) if bloques is not None else None
    for clase, minz_clase, partes in poligonos(region):
        anillos = [proyectar(p) for p in partes if len(p) >= 6]
        if not anillos:
            continue  # polígono vacío o degenerado en los datos
        # Zoom mínimo por tamaño: que mida al menos ~3 px de lado
        x0, y0, x1, y1 = _caja(anillos)
        lado = max(x1 - x0, y1 - y0) * 256
        minz = max(minz_clase, math.ceil(math.log2(3 / lado)) if lado > 0 else 99)
        if minz > zmax:
            continue
        if admitir and not admitir(math.floor(x0 * escala), math.floor(y0 * escala),
                                   math.floor(x1 * escala) + 1, math.floor(y1 * escala) + 1):
            continue
        anillos = [simplificar(a, tol) for a in anillos]
        anillos = [a for a in anillos if len(a) >= 8]
        if not anillos:
            continue
        for (tx, ty), trozos in partir_poligono(anillos, escala, admitir).items():
            if bloques is not None and not bloques.contiene(tx, ty, nivel):
                continue
            t = teselas[(tx, ty)]
            cod = [codificar(a, tx, ty, ext, cerrado=True) for a in trozos]
            cod = [c for c in cod if c is not None]
            if cod:
                t.features.append([id_clase[clase], minz, cod])
    escribir_tmp(teselas, carpeta, "p", nivel)
    return len(teselas)


def generar_region(region, bloques, solo_detalle=False):
    carpeta = os.path.join(CARPETA_TMP, region)
    hecho = os.path.join(carpeta, "HECHO")
    if os.path.exists(hecho) and solo_detalle:
        # Rehacer solo el detalle (zonas con carreras), reutilizando el mapa base
        asegurar_datos(region)
        inicio = time.time()
        for capa in ("l", "p"):
            vieja = os.path.join(carpeta, capa, str(NIVEL_DETALLE))
            if os.path.exists(vieja):
                shutil.rmtree(vieja)
        n_p = generar_poligonos(region, NIVEL_DETALLE, RESOL_DETALLE, bloques, carpeta)
        n_l = generar_lineas(region, NIVEL_DETALLE, RESOL_DETALLE, bloques, carpeta)
        print(f"{region}: detalle rehecho ({n_l} teselas de líneas, {n_p} de polígonos) en {time.time() - inicio:.0f} s")
        return
    if os.path.exists(hecho):
        print(f"{region}: ya generada (se reutiliza)")
        return
    asegurar_datos(region)
    if os.path.exists(carpeta):
        shutil.rmtree(carpeta)
    os.makedirs(carpeta)
    inicio = time.time()
    for nivel, zmax in NIVELES_BASE:
        n_p = generar_poligonos(region, nivel, zmax, None, carpeta)
        n_l = generar_lineas(region, nivel, zmax, None, carpeta)
        print(f"  {region} nivel {nivel}: {n_l} teselas de líneas, {n_p} de polígonos")
    n_p = generar_poligonos(region, NIVEL_DETALLE, RESOL_DETALLE, bloques, carpeta)
    n_l = generar_lineas(region, NIVEL_DETALLE, RESOL_DETALLE, bloques, carpeta)
    print(f"  {region} detalle: {n_l} teselas de líneas, {n_p} de polígonos")
    open(hecho, "w").close()
    print(f"{region}: lista en {time.time() - inicio:.0f} s")


# ---------------------------------------------------------------------------
# Etiquetas de pueblos y picos: se calculan para toda España a la vez (así no chocan
# en las fronteras entre comunidades)
# ---------------------------------------------------------------------------

def caja_etiqueta(p, escala):
    fs = FUENTE_T[p["clase"]]
    ancho = len(p["nombre"]) * fs * 0.58 + 8
    alto = fs + 6
    cx, cy = p["x"] * escala, p["y"] * escala
    if p["clase"] == "pico":  # triángulo encima, nombre debajo
        return cx - ancho / 2, cy - 6, cx + ancho / 2, cy + alto + 4
    return cx - ancho / 2, cy - alto / 2, cx + ancho / 2, cy + alto / 2


def calcular_mascaras(lista):
    lista.sort(key=lambda p: p["prioridad"])
    for p in lista:
        p["mascara"] = 0
    celda = 128
    for z in ZOOMS_ETIQUETAS:
        escala = 256 * 2 ** z
        rejilla = defaultdict(list)
        for p in lista:
            if MINZ_T[p["clase"]] > z:
                continue
            x0, y0, x1, y1 = caja_etiqueta(p, escala)
            celdas = [(cx, cy) for cx in range(int(x0 // celda), int(x1 // celda) + 1)
                      for cy in range(int(y0 // celda), int(y1 // celda) + 1)]
            choca = any(x0 < b[2] and x1 > b[0] and y0 < b[3] and y1 > b[1]
                        for c in celdas for b in rejilla[c])
            if not choca:
                for c in celdas:
                    rejilla[c].append((x0, y0, x1, y1))
                p["mascara"] |= 1 << z


def generar_etiquetas(regiones, bloques):
    carpeta = os.path.join(CARPETA_TMP, "_etiquetas")
    if os.path.exists(carpeta):
        shutil.rmtree(carpeta)
    vistos, lista = set(), []
    for region in regiones:
        for p in puntos(region):
            clave = (p["clase"], p["nombre"], round(p["x"], 7), round(p["y"], 7))
            if clave not in vistos:
                vistos.add(clave)
                lista.append(p)
    calcular_mascaras(lista)
    print(f"Etiquetas: {len(lista):,} pueblos, barrios y picos")
    id_t = {c: i for i, c in enumerate(CLASES_T)}
    for nivel, zmax in NIVELES_BASE + [(NIVEL_DETALLE, ZMAX_DETALLE)]:
        ext = extension(nivel, RESOL_DETALLE if nivel == NIVEL_DETALLE else zmax)
        escala = 2 ** nivel
        bits = sum(1 << z for z in range(nivel, zmax + 1))
        teselas = defaultdict(Tesela)
        for p in lista:
            if not p["mascara"] & bits:
                continue
            x0, y0, x1, y1 = caja_etiqueta(p, 256 * 2 ** nivel)
            margen_x = (x1 - x0) / 2 / 256 + 0.05
            margen_y = (y1 - y0) / 256 + 0.05
            px, py = p["x"] * escala, p["y"] * escala
            for tx in range(math.floor(px - margen_x), math.floor(px + margen_x) + 1):
                for ty in range(math.floor(py - margen_y), math.floor(py + margen_y) + 1):
                    if nivel == NIVEL_DETALLE and not bloques.contiene(tx, ty, nivel):
                        continue
                    t = teselas[(tx, ty)]
                    t.features.append([id_t[p["clase"]], p["mascara"], t.indice(p["nombre"]),
                                       round((px - tx) * ext), round((py - ty) * ext)])
        escribir_tmp(teselas, carpeta, "l", nivel)


# ---------------------------------------------------------------------------
# Unión de comunidades, compresión y paquetes de detalle
# ---------------------------------------------------------------------------

def unir_tesela(rutas):
    """Junta las teselas de varias comunidades: une nombres y quita features repetidas
    (las vías que cruzan una frontera vienen en las dos comunidades)."""
    nombres, features, vistas = {}, [], set()
    for ruta in rutas:
        with open(ruta, encoding="utf-8") as f:
            d = json.load(f)
        mapa = []
        for texto in d["n"]:
            if texto not in nombres:
                nombres[texto] = len(nombres)
            mapa.append(nombres[texto])
        for feat in d["f"]:
            if len(feat) == 6:      # línea: [clase, minz, nombre, ref, flags, coords]
                feat = [feat[0], feat[1], mapa[feat[2]] if feat[2] >= 0 else -1,
                        mapa[feat[3]] if feat[3] >= 0 else -1, feat[4], feat[5]]
            elif len(feat) == 5:    # punto: [clase, máscara, nombre, u, v]
                feat = [feat[0], feat[1], mapa[feat[2]], feat[3], feat[4]]
            clave = json.dumps(feat, separators=(",", ":"))
            if clave not in vistas:
                vistas.add(clave)
                features.append(feat)
    # Polígonos primero por clase no hace falta: el renderizador agrupa por clase
    return {"n": list(nombres), "f": features}


def comprimir(datos):
    texto = json.dumps(datos, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return gzip.compress(texto, compresslevel=9, mtime=0)


def indice_tmp(capa, nivel):
    """{(tx, ty): [rutas de cada comunidad]} de una capa y nivel en la carpeta temporal."""
    indice = defaultdict(list)
    for origen in os.listdir(CARPETA_TMP):
        base = os.path.join(CARPETA_TMP, origen, capa, str(nivel))
        if not os.path.isdir(base):
            continue
        for x in os.listdir(base):
            for archivo in os.listdir(os.path.join(base, x)):
                indice[(int(x), int(archivo[:-5]))].append(os.path.join(base, x, archivo))
    return indice


def mascara_existencia(claves):
    """Bits de qué teselas existen dentro de su rectángulo (para no pedir teselas de mar)."""
    if not claves:
        return None
    x0, y0 = min(k[0] for k in claves), min(k[1] for k in claves)
    x1, y1 = max(k[0] for k in claves), max(k[1] for k in claves)
    ancho, alto = x1 - x0 + 1, y1 - y0 + 1
    bits = bytearray((ancho * alto + 7) // 8)
    for x, y in claves:
        i = (y - y0) * ancho + (x - x0)
        bits[i >> 3] |= 1 << (i & 7)
    return {"x0": x0, "y0": y0, "ancho": ancho, "alto": alto, "bits": base64.b64encode(bytes(bits)).decode()}


def unir_y_escribir():
    if os.path.exists(SALIDA):
        shutil.rmtree(SALIDA)
    os.makedirs(SALIDA)
    existencia = {}
    for capa in ("l", "p"):
        for nivel, _ in NIVELES_BASE:
            indice = indice_tmp(capa, nivel)
            for (tx, ty), rutas in indice.items():
                destino = os.path.join(SALIDA, capa, str(nivel), str(tx))
                os.makedirs(destino, exist_ok=True)
                with open(os.path.join(destino, f"{ty}.bin"), "wb") as f:
                    f.write(comprimir(unir_tesela(rutas)))
            existencia[f"{capa}{nivel}"] = mascara_existencia(list(indice))
            print(f"  {capa}/{nivel}: {len(indice):,} teselas")

        # Detalle: paquetes de 4 x 4 teselas por tesela de nivel 12
        indice = indice_tmp(capa, NIVEL_DETALLE)
        k = NIVEL_DETALLE - NIVEL_PAQUETE
        paquetes = defaultdict(dict)
        for (tx, ty), rutas in indice.items():
            paquetes[(tx >> k, ty >> k)][f"{tx & ((1 << k) - 1)}_{ty & ((1 << k) - 1)}"] = rutas
        for (px, py), hijas in paquetes.items():
            contenido = {clave: unir_tesela(rutas) for clave, rutas in hijas.items()}
            destino = os.path.join(SALIDA, capa, str(NIVEL_DETALLE), str(px))
            os.makedirs(destino, exist_ok=True)
            with open(os.path.join(destino, f"{py}.bin"), "wb") as f:
                f.write(comprimir(contenido))
        existencia[f"{capa}{NIVEL_DETALLE}"] = mascara_existencia(list(paquetes))
        print(f"  {capa}/{NIVEL_DETALLE}: {len(indice):,} teselas en {len(paquetes):,} paquetes")
    return existencia


def descargar_todo(regiones, horas_max=12):
    """Descarga los extractos que falten, reintentando cada 5 minutos (Geofabrik falla a ratos)."""
    fin = time.time() + horas_max * 3600
    while True:
        faltan = [r for r in regiones if not os.path.exists(os.path.join(carpeta_region(r), "free.shp.zip"))]
        if not faltan:
            print("Descargas completas")
            return True
        print(f"[{time.strftime('%H:%M')}] faltan {len(faltan)}: {', '.join(faltan)}")
        for region in faltan:
            carpeta = carpeta_region(region)
            os.makedirs(carpeta, exist_ok=True)
            zip_path = os.path.join(carpeta, "free.shp.zip")
            url = f"{GEOFABRIK}{REGIONES[region]}-latest-free.shp.zip"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "RunNear/0.2 (mapa propio; runnear.app@gmail.com)"})
                with urllib.request.urlopen(req, timeout=1200) as r, open(zip_path + ".parcial", "wb") as f:
                    shutil.copyfileobj(r, f)
                os.replace(zip_path + ".parcial", zip_path)
                print(f"  {region}: descargada ({os.path.getsize(zip_path) // 1024 // 1024} MB)")
            except Exception as e:
                print(f"  {region}: {e}")
            time.sleep(5)  # sin prisas: no saturar el servidor
        if time.time() > fin:
            print("Tiempo agotado: vuelve a ejecutar más tarde")
            return False
        time.sleep(300)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--regiones", nargs="*", default=list(REGIONES), help="comunidades a procesar")
    parser.add_argument("--rehacer", action="store_true", help="no reutilizar comunidades ya generadas")
    parser.add_argument("--solo-detalle", action="store_true",
                        help="rehacer solo el detalle (p. ej. con carreras en zonas nuevas), reutilizando el mapa base")
    parser.add_argument("--detalle-extra", nargs="*", default=[], metavar="LAT,LNG",
                        help="puntos adicionales con detalle, p. ej. 40.4168,-3.7038")
    parser.add_argument("--solo-descargar", action="store_true",
                        help="solo descargar los extractos que falten (reintenta cada 5 min hasta 12 h)")
    args = parser.parse_args()
    inicio = time.time()

    if args.solo_descargar:
        sys.exit(0 if descargar_todo(args.regiones) else 1)

    extra =[tuple(float(v) for v in p.split(",")) for p in args.detalle_extra]
    bloques = Bloques(bloques_de_carreras(extra))
    print(f"Zonas de detalle: {len(bloques.claves)} bloques de ~30 km con carreras")

    if args.rehacer and os.path.exists(CARPETA_TMP):
        shutil.rmtree(CARPETA_TMP)
    os.makedirs(CARPETA_TMP, exist_ok=True)
    pendientes = list(args.regiones)
    for ronda in range(2):  # las que fallan (descarga) se reintentan al final
        fallidas = []
        for region in pendientes:
            print(f"== {region}")
            try:
                generar_region(region, bloques, args.solo_detalle)
            except Exception as e:
                print(f"!! {region} no se pudo generar: {e}")
                fallidas.append(region)
        pendientes = fallidas
        if not pendientes:
            break
    if pendientes:
        print(f"ERROR: faltan {', '.join(pendientes)}. Vuelve a ejecutar más tarde: las demás se reutilizan.")
        sys.exit(1)

    generar_etiquetas(args.regiones, bloques)

    print("Uniendo comunidades y comprimiendo...")
    existencia = unir_y_escribir()

    meta = {
        "version": 2,
        "generado": date.today().isoformat(),
        "atribucion": "© OpenStreetMap contributors (ODbL)",
        "formato": "gzip-json",
        "niveles": [[n, z, extension(n, z)] for n, z in NIVELES_BASE],
        "detalle": {"nivel": NIVEL_DETALLE, "zmax": ZMAX_DETALLE, "ext": extension(NIVEL_DETALLE, RESOL_DETALLE),
                    "paquete": NIVEL_PAQUETE, "bloque": NIVEL_BLOQUE,
                    "bloques": sorted(f"{x}_{y}" for x, y in bloques.claves)},
        "existe": existencia,
        "clases_l": CLASES_L, "clases_p": CLASES_P, "clases_t": CLASES_T,
        "fuente_t": FUENTE_T,
    }
    with open(os.path.join(SALIDA, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(SALIDA) for f in fs)
    archivos = sum(len(fs) for _, _, fs in os.walk(SALIDA))
    print(f"OK: {archivos:,} archivos, {total / 1024 / 1024:.1f} MB en {SALIDA} ({(time.time() - inicio) / 60:.0f} min)")


if __name__ == "__main__":
    main()
