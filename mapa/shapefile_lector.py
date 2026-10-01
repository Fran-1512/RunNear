"""
Lector mínimo de shapefiles (.shp + .dbf) con la biblioteca estándar.

Soporta los tipos que usa el extracto de Geofabrik: Point (1), PolyLine (3)
y Polygon (5). Especificación: ESRI Shapefile Technical Description (1998).
"""

import struct
from array import array

PUNTO, LINEA, POLIGONO = 1, 3, 5


def leer_dbf(ruta, campos=None, codificacion="utf-8"):
    """Genera un dict por registro con los campos pedidos (o todos)."""
    with open(ruta, "rb") as f:
        datos = f.read()
    num_registros, long_cabecera, long_registro = struct.unpack_from("<IHH", datos, 4)

    # Descriptores de campo: bloques de 32 bytes hasta el terminador 0x0D
    descriptores = []
    pos, desplazamiento = 32, 1  # el primer byte de cada registro es la marca de borrado
    while datos[pos] != 0x0D:
        nombre = datos[pos:pos + 11].split(b"\0", 1)[0].decode("ascii")
        tipo = chr(datos[pos + 11])
        longitud = datos[pos + 16]
        if campos is None or nombre in campos:
            descriptores.append((nombre, tipo, desplazamiento, longitud))
        desplazamiento += longitud
        pos += 32

    for i in range(num_registros):
        base = long_cabecera + i * long_registro
        registro = {}
        for nombre, tipo, desp, longitud in descriptores:
            crudo = datos[base + desp: base + desp + longitud]
            texto = crudo.decode(codificacion, errors="replace").strip()
            if tipo in "NF":
                try:
                    registro[nombre] = float(texto) if "." in texto else int(texto)
                except ValueError:
                    registro[nombre] = None
            else:
                registro[nombre] = texto
        yield registro


def leer_shp(ruta):
    """
    Genera (tipo, partes) por registro, en el mismo orden que el .dbf.
      - Punto:            partes = (x, y)
      - Línea / Polígono: partes = [array('d', [x0, y0, x1, y1, ...]), ...]
      - Registro nulo:    (0, None)
    """
    with open(ruta, "rb") as f:
        datos = memoryview(f.read())

    pos = 100  # cabecera fija del fichero
    total = len(datos)
    while pos + 8 <= total:
        _, long_contenido = struct.unpack_from(">ii", datos, pos)
        pos += 8
        fin = pos + long_contenido * 2
        tipo = struct.unpack_from("<i", datos, pos)[0]

        if tipo == 0:
            yield 0, None
        elif tipo == PUNTO:
            yield PUNTO, struct.unpack_from("<2d", datos, pos + 4)
        elif tipo in (LINEA, POLIGONO):
            num_partes, num_puntos = struct.unpack_from("<2i", datos, pos + 36)
            inicios = struct.unpack_from(f"<{num_partes}i", datos, pos + 44)
            base_puntos = pos + 44 + 4 * num_partes
            coords = array("d")
            coords.frombytes(datos[base_puntos: base_puntos + 16 * num_puntos])
            limites = list(inicios) + [num_puntos]
            partes = [coords[2 * limites[k]: 2 * limites[k + 1]] for k in range(num_partes)]
            yield tipo, partes
        else:
            raise ValueError(f"Tipo de geometría no soportado: {tipo} en {ruta}")
        pos = fin


def leer_capa(ruta_sin_extension, campos=None):
    """Recorre .shp y .dbf a la vez: genera (tipo, geometria, atributos)."""
    for (tipo, geom), attrs in zip(leer_shp(ruta_sin_extension + ".shp"),
                                   leer_dbf(ruta_sin_extension + ".dbf", campos)):
        if geom is not None:
            yield tipo, geom, attrs
