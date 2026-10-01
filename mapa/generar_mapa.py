#!/usr/bin/env python3
"""
Genera el mapa base propio (mapa/mapa_base.json) a partir de Natural Earth.

Natural Earth es de DOMINIO PÚBLICO: se puede usar, modificar y publicar sin pagar,
sin API key y sin obligación de atribución. Este script se ejecuta UNA vez (o cuando
se quiera regenerar); después la app no depende de ningún servidor de mapas externo.

Uso (desde la carpeta del proyecto):
    py mapa/generar_mapa.py
"""

import json
import os
import sys
import tempfile
import urllib.request

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mapa_base.json")
CACHE_DESCARGAS = os.path.join(tempfile.gettempdir(), "runnear_natural_earth")

# Encuadre: península ibérica y alrededores (lng_min, lat_min, lng_max, lat_max)
BBOX = (-10.5, 35.0, 5.0, 44.5)
REGION_DESTACADA = "Castilla-La Mancha"

# Tolerancias de simplificación (grados; 0.001 ≈ 100 m)
TOL_PAISES = 0.01
TOL_PROVINCIAS = 0.004
TOL_LINEAS = 0.003


# ---------------------------------------------------------------------------
# Descarga y utilidades geométricas
# ---------------------------------------------------------------------------

def descargar_geojson(nombre):
    os.makedirs(CACHE_DESCARGAS, exist_ok=True)
    ruta = os.path.join(CACHE_DESCARGAS, nombre)
    if not os.path.exists(ruta):
        print(f"  descargando {nombre}...")
        req = urllib.request.Request(NE_BASE + nombre, headers={"User-Agent": "RunNear/0.1"})
        with urllib.request.urlopen(req, timeout=300) as resp, open(ruta, "wb") as f:
            f.write(resp.read())
    with open(ruta, "r", encoding="utf-8") as f:
        return json.load(f)


def _coords_planas(geom):
    """Itera todos los [lng, lat] de una geometría."""
    t, c = geom["type"], geom["coordinates"]
    if t == "Point":
        yield c
    elif t in ("LineString", "MultiPoint"):
        yield from c
    elif t in ("Polygon", "MultiLineString"):
        for parte in c:
            yield from parte
    elif t == "MultiPolygon":
        for poligono in c:
            for anillo in poligono:
                yield from anillo


def intersecta_bbox(geom):
    puntos = [(p[0], p[1]) for p in _coords_planas(geom)]
    if not puntos:
        return False  # geometrías vacías en algunos ficheros de Natural Earth
    xs, ys = zip(*puntos)
    return not (max(xs) < BBOX[0] or min(xs) > BBOX[2] or max(ys) < BBOX[1] or min(ys) > BBOX[3])


def _dist_perpendicular(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / (dx * dx + dy * dy) ** 0.5


def simplificar_linea(puntos, tol):
    """Douglas-Peucker iterativo (sin recursión para líneas largas)."""
    if len(puntos) < 3:
        return puntos
    conservar = [False] * len(puntos)
    conservar[0] = conservar[-1] = True
    pila = [(0, len(puntos) - 1)]
    while pila:
        ini, fin = pila.pop()
        max_d, idx = 0.0, None
        for i in range(ini + 1, fin):
            d = _dist_perpendicular(puntos[i], puntos[ini], puntos[fin])
            if d > max_d:
                max_d, idx = d, i
        if idx is not None and max_d > tol:
            conservar[idx] = True
            pila.append((ini, idx))
            pila.append((idx, fin))
    return [p for p, k in zip(puntos, conservar) if k]


def _redondear(puntos):
    return [[round(p[0], 4), round(p[1], 4)] for p in puntos]


def simplificar(geom, tol):
    t, c = geom["type"], geom["coordinates"]
    if t == "LineString":
        return {"type": t, "coordinates": _redondear(simplificar_linea(c, tol))}
    if t == "MultiLineString":
        return {"type": t, "coordinates": [_redondear(simplificar_linea(l, tol)) for l in c]}
    if t == "Polygon":
        anillos = [_redondear(simplificar_linea(a, tol)) for a in c]
        return {"type": t, "coordinates": [a for a in anillos if len(a) >= 4]}
    if t == "MultiPolygon":
        polis = []
        for poligono in c:
            anillos = [_redondear(simplificar_linea(a, tol)) for a in poligono]
            anillos = [a for a in anillos if len(a) >= 4]
            if anillos:
                polis.append(anillos)
        return {"type": t, "coordinates": polis}
    return geom


def feature(geom, props):
    return {"type": "Feature", "geometry": geom, "properties": props}


# ---------------------------------------------------------------------------
# Capas
# ---------------------------------------------------------------------------

def capa_paises():
    """Países vecinos (España se dibuja por provincias)."""
    datos = descargar_geojson("ne_50m_admin_0_countries.geojson")
    salida = []
    for f in datos["features"]:
        p = f["properties"]
        if p.get("ADM0_A3") == "ESP" or not intersecta_bbox(f["geometry"]):
            continue
        salida.append(feature(simplificar(f["geometry"], TOL_PAISES), {"nombre": p.get("NAME_ES") or p.get("NAME")}))
    return salida


def capa_provincias():
    datos = descargar_geojson("ne_10m_admin_1_states_provinces.geojson")
    salida = []
    for f in datos["features"]:
        p = f["properties"]
        if p.get("adm0_a3") != "ESP" or not intersecta_bbox(f["geometry"]):
            continue
        salida.append(feature(simplificar(f["geometry"], TOL_PROVINCIAS), {
            "nombre": p.get("name"),
            "region": p.get("region"),
            "destacada": p.get("region") == REGION_DESTACADA,
        }))
    return salida


def capa_rios():
    salida = []
    for nombre in ("ne_10m_rivers_lake_centerlines.geojson", "ne_10m_rivers_europe.geojson"):
        for f in descargar_geojson(nombre)["features"]:
            if not f.get("geometry") or not intersecta_bbox(f["geometry"]):
                continue
            p = f["properties"]
            salida.append(feature(simplificar(f["geometry"], TOL_LINEAS), {
                "nombre": p.get("name_es") or p.get("name"),
                "rango": p.get("scalerank"),
            }))
    return salida


def capa_carreteras():
    datos = descargar_geojson("ne_10m_roads.geojson")
    salida = []
    for f in datos["features"]:
        p = f["properties"]
        if not f.get("geometry") or p.get("continent") != "Europe" or not intersecta_bbox(f["geometry"]):
            continue
        salida.append(feature(simplificar(f["geometry"], TOL_LINEAS), {
            "tipo": "autovia" if p.get("expressway") == 1 or p.get("type") == "Major Highway" else "carretera",
            "ref": p.get("name") or "",
        }))
    return salida


def capa_poblaciones():
    datos = descargar_geojson("ne_10m_populated_places_simple.geojson")
    salida = []
    for f in datos["features"]:
        if not intersecta_bbox(f["geometry"]):
            continue
        p = f["properties"]
        lng, lat = f["geometry"]["coordinates"][:2]
        salida.append(feature({"type": "Point", "coordinates": [round(lng, 4), round(lat, 4)]}, {
            "nombre": p.get("name"),
            "poblacion": p.get("pop_max") or 0,
            "capital": bool(p.get("adm0cap")) or p.get("featurecla") == "Admin-1 capital",
            "rango": p.get("scalerank"),
        }))
    return salida


def main():
    print("Generando mapa base propio desde Natural Earth (dominio público)...")
    capas = {
        "paises": capa_paises(),
        "provincias": capa_provincias(),
        "rios": capa_rios(),
        "carreteras": capa_carreteras(),
        "poblaciones": capa_poblaciones(),
    }
    mapa = {
        "fuente": "Natural Earth (dominio público) - naturalearthdata.com",
        "bbox": BBOX,
        "capas": {k: {"type": "FeatureCollection", "features": v} for k, v in capas.items()},
    }
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(mapa, f, ensure_ascii=False, separators=(",", ":"))

    for k, v in capas.items():
        print(f"  {k}: {len(v)} elementos")
    destacadas = [f["properties"]["nombre"] for f in capas["provincias"] if f["properties"]["destacada"]]
    print(f"  provincias de {REGION_DESTACADA}: {', '.join(destacadas) or 'NINGUNA (revisar campo region)'}")
    print(f"OK: {SALIDA} ({os.path.getsize(SALIDA) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
