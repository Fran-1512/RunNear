#!/usr/bin/env python3
"""
Genera teselas vectoriales PROPIAS del mapa detallado de Castilla-La Mancha
a partir del extracto de OpenStreetMap de Geofabrik (shapefiles).

Resultado: mapa/teselas/  (JSON estáticos que sirve app.py; ningún servidor externo)
  l/{nivel}/{x}/{y}.json  -> líneas (carreteras, calles, caminos, ríos, límites) y puntos (pueblos, picos)
  p/{nivel}/{x}/{y}.json  -> polígonos (agua, bosques, casco urbano, viñedos...)
  meta.json               -> niveles, clases y rangos de teselas

Licencia de los datos: © OpenStreetMap contributors, ODbL. Uso libre y gratuito
con la única condición de citar la fuente (se muestra en la esquina del mapa).

Uso (desde la carpeta del proyecto, solo cuando se quiera regenerar):
    py mapa/generar_teselas.py
"""

import json
import math
import os
import shutil
import sys
import tempfile
import time
import urllib.request
import zipfile
from array import array
from collections import defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shapefile_lector import LINEA, POLIGONO, leer_capa  # noqa: E402

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

URL_EXTRACTO = "https://download.geofabrik.de/europe/spain/castilla-la-mancha-latest-free.shp.zip"
CARPETA_DATOS = os.path.join(tempfile.gettempdir(), "runnear_osm")
CARPETA_SHP = os.path.join(CARPETA_DATOS, "shp")
SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "teselas")

# (nivel de datos, zoom máximo que sirve). Un nivel se reutiliza ("sobrezoom") hasta su zoom máximo.
NIVELES_L = [(8, 9), (10, 11), (12, 13), (14, 18)]
NIVELES_P = [(8, 9), (10, 11), (12, 18)]
ZOOMS_ETIQUETAS = range(8, 19)
TOL_PX = 0.8          # tolerancia de simplificación, en píxeles al zoom máximo del nivel
BUFFER_POLIGONO = 0.02  # solape entre teselas vecinas (fracción de tesela) para evitar costuras


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


def partir_poligono(anillos, escala):
    """
    Reparte un polígono (anillos en Mercator normalizado) entre las teselas del nivel,
    recortando por mitades recursivamente (coste ~ puntos x log(teselas)).
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
    """Tramo en unidades de tesela -> array('i') de enteros locales con deltas."""
    salida = array("i")
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
# Teselas en memoria
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
        return {"n": list(self.nombres), "f": [
            [x.tolist() if isinstance(x, array) else
             ([r.tolist() for r in x] if isinstance(x, list) and x and isinstance(x[0], array) else x)
             for x in f] for f in self.features]}


def escribir(teselas, capa, nivel):
    rango = [None, None, None, None]
    for (tx, ty), t in teselas.items():
        carpeta = os.path.join(SALIDA, capa, str(nivel), str(tx))
        os.makedirs(carpeta, exist_ok=True)
        with open(os.path.join(carpeta, f"{ty}.json"), "w", encoding="utf-8") as f:
            json.dump(t.a_json(), f, ensure_ascii=False, separators=(",", ":"))
        rango = [tx if rango[0] is None else min(rango[0], tx), ty if rango[1] is None else min(rango[1], ty),
                 tx if rango[2] is None else max(rango[2], tx), ty if rango[3] is None else max(rango[3], ty)]
    return rango


def ruta_capa(nombre):
    return os.path.join(CARPETA_SHP, f"gis_osm_{nombre}_free_1")


# ---------------------------------------------------------------------------
# Lectura de capas (generadores de features ya clasificadas)
# ---------------------------------------------------------------------------

def lineas():
    """(clase, minz, nombre, ref, flags, partes)"""
    for _, partes, a in leer_capa(ruta_capa("roads"), ["fclass", "name", "ref", "bridge", "tunnel"]):
        clase = VIAS.get(a["fclass"])
        if clase:
            flags = (1 if a.get("tunnel") == "T" else 0) | (2 if a.get("bridge") == "T" else 0)
            yield clase[0], clase[1], a.get("name", ""), a.get("ref", ""), flags, partes
    for _, partes, a in leer_capa(ruta_capa("waterways"), ["fclass", "name"]):
        clase = CURSOS_AGUA.get(a["fclass"])
        if clase:
            yield clase[0], clase[1], a.get("name", ""), "", 0, partes
    for _, partes, a in leer_capa(ruta_capa("railways"), ["fclass", "tunnel"]):
        yield "ferrocarril", 9, "", "", (1 if a.get("tunnel") == "T" else 0), partes
    for _, partes, a in leer_capa(ruta_capa("adminareas_a"), ["fclass"]):
        if a["fclass"] == "admin_level8":
            yield "limite_municipal", 11, "", "", 0, partes
        elif a["fclass"] == "admin_level6":
            yield "limite_provincial", 8, "", "", 0, partes


def poligonos():
    """(clase, minz_clase, partes)"""
    for _, partes, a in leer_capa(ruta_capa("water_a"), ["fclass"]):
        fc = a["fclass"]
        if fc in ("water", "reservoir", "riverbank"):
            yield "agua", 8, partes
        elif fc.startswith("wetland"):
            yield "humedal", 12, partes
    for _, partes, a in leer_capa(ruta_capa("landuse_a"), ["fclass"]):
        clase = USOS_SUELO.get(a["fclass"])
        if clase:
            yield clase[0], clase[1], partes


def puntos():
    """Lista de dicts: clase, nombre, x, y, prioridad"""
    lista = []
    for _, (lon, lat), a in leer_capa(ruta_capa("places"), ["fclass", "name", "population"]):
        clase = LUGARES.get(a["fclass"])
        if clase and a.get("name"):
            x, y = proyectar([lon, lat])
            lista.append({"clase": clase, "nombre": a["name"], "x": x, "y": y,
                          "prioridad": (RANGO_T[clase], -(a.get("population") or 0))})
    for _, (lon, lat), a in leer_capa(ruta_capa("natural"), ["fclass", "name"]):
        if a["fclass"] == "peak" and a.get("name"):
            x, y = proyectar([lon, lat])
            lista.append({"clase": "pico", "nombre": a["name"], "x": x, "y": y,
                          "prioridad": (RANGO_T["pico"], 0)})
    return lista


# ---------------------------------------------------------------------------
# Etiquetas: qué nombres caben en cada zoom (colisiones calculadas una sola vez)
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


# ---------------------------------------------------------------------------
# Generación por niveles
# ---------------------------------------------------------------------------

def generar_nivel_lineas(nivel, zmax, lista_puntos):
    ext = extension(nivel, zmax)
    escala = 2 ** nivel
    tol = TOL_PX / (256 * 2 ** zmax)
    teselas = defaultdict(Tesela)
    id_clase = {c: i for i, c in enumerate(CLASES_L)}
    n = 0
    for clase, minz, nombre, ref, flags, partes in lineas():
        if minz > zmax:
            continue
        for parte in partes:
            pts = simplificar(proyectar(parte), tol)
            if len(pts) < 4:
                continue
            for (tx, ty), tramos in partir_linea(pts, escala).items():
                t = teselas[(tx, ty)]
                for tramo in tramos:
                    coords = codificar(tramo, tx, ty, ext)
                    if coords is not None:
                        t.features.append([id_clase[clase], minz, t.indice(nombre), t.indice(ref), flags, coords])
                        n += 1

    # Puntos con alguna etiqueta visible en los zooms que sirve este nivel
    bits = sum(1 << z for z in range(nivel, zmax + 1))
    id_t = {c: i for i, c in enumerate(CLASES_T)}
    for p in lista_puntos:
        if not p["mascara"] & bits:
            continue
        x0, y0, x1, y1 = caja_etiqueta(p, 256 * 2 ** nivel)
        margen_x = (x1 - x0) / 2 / 256 + 0.05
        margen_y = (y1 - y0) / 256 + 0.05
        px, py = p["x"] * escala, p["y"] * escala
        for tx in range(math.floor(px - margen_x), math.floor(px + margen_x) + 1):
            for ty in range(math.floor(py - margen_y), math.floor(py + margen_y) + 1):
                t = teselas[(tx, ty)]
                t.features.append([id_t[p["clase"]], p["mascara"], t.indice(p["nombre"]),
                                   round((px - tx) * ext), round((py - ty) * ext)])
    rango = escribir(teselas, "l", nivel)
    print(f"  líneas nivel {nivel}: {len(teselas)} teselas, {n:,} tramos")
    return rango


def generar_nivel_poligonos(nivel, zmax):
    ext = extension(nivel, zmax)
    escala = 2 ** nivel
    tol = TOL_PX / (256 * 2 ** zmax)
    teselas = defaultdict(Tesela)
    id_clase = {c: i for i, c in enumerate(CLASES_P)}
    n = 0
    for clase, minz_clase, partes in poligonos():
        anillos = [proyectar(p) for p in partes]
        # Zoom mínimo por tamaño: que mida al menos ~3 px de lado
        x0, y0, x1, y1 = _caja(anillos)
        lado = max(x1 - x0, y1 - y0) * 256
        minz = max(minz_clase, math.ceil(math.log2(3 / lado)) if lado > 0 else 99)
        if minz > zmax:
            continue
        anillos = [simplificar(a, tol) for a in anillos]
        anillos = [a for a in anillos if len(a) >= 8]
        if not anillos:
            continue
        for (tx, ty), trozos in partir_poligono(anillos, escala).items():
            cod = [codificar(a, tx, ty, ext, cerrado=True) for a in trozos]
            cod = [c for c in cod if c is not None]
            if cod:
                teselas[(tx, ty)].features.append([id_clase[clase], minz, cod])
                n += 1
    rango = escribir(teselas, "p", nivel)
    print(f"  polígonos nivel {nivel}: {len(teselas)} teselas, {n:,} piezas")
    return rango


def asegurar_datos():
    if os.path.exists(ruta_capa("roads") + ".shp"):
        return
    os.makedirs(CARPETA_DATOS, exist_ok=True)
    zip_path = os.path.join(CARPETA_DATOS, "clm-free.shp.zip")
    if not os.path.exists(zip_path):
        print(f"Descargando extracto OSM ({URL_EXTRACTO})...")
        req = urllib.request.Request(URL_EXTRACTO, headers={"User-Agent": "RunNear/0.1"})
        with urllib.request.urlopen(req, timeout=600) as r, open(zip_path, "wb") as f:
            shutil.copyfileobj(r, f)
    print("Descomprimiendo...")
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(CARPETA_SHP)


def main():
    inicio = time.time()
    asegurar_datos()
    if os.path.exists(SALIDA):
        shutil.rmtree(SALIDA)
    os.makedirs(SALIDA)

    print("Calculando etiquetas de pueblos y picos...")
    lista_puntos = puntos()
    calcular_mascaras(lista_puntos)
    print(f"  {len(lista_puntos):,} puntos con nombre")

    rangos = {}
    for nivel, zmax in NIVELES_P:
        t = time.time()
        rangos[f"p{nivel}"] = generar_nivel_poligonos(nivel, zmax)
        print(f"    ({time.time() - t:.0f} s)")
    for nivel, zmax in NIVELES_L:
        t = time.time()
        rangos[f"l{nivel}"] = generar_nivel_lineas(nivel, zmax, lista_puntos)
        print(f"    ({time.time() - t:.0f} s)")

    meta = {
        "generado": date.today().isoformat(),
        "atribucion": "© OpenStreetMap contributors (ODbL)",
        "niveles_l": [[n, z, extension(n, z)] for n, z in NIVELES_L],
        "niveles_p": [[n, z, extension(n, z)] for n, z in NIVELES_P],
        "clases_l": CLASES_L, "clases_p": CLASES_P, "clases_t": CLASES_T,
        "fuente_t": FUENTE_T,
        "rangos": rangos,
    }
    with open(os.path.join(SALIDA, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(SALIDA) for f in fs)
    archivos = sum(len(fs) for _, _, fs in os.walk(SALIDA))
    print(f"OK: {archivos:,} archivos, {total / 1024 / 1024:.1f} MB en {SALIDA} ({time.time() - inicio:.0f} s)")


if __name__ == "__main__":
    main()
