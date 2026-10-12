"""Compara dos tandas de capturas de tests/navegador/capturas.ps1 píxel a píxel (solo biblioteca estándar).
Uso: py tests/navegador/comparar_capturas.py antes despues  -> % de píxeles distintos y zona donde están."""
import os
import struct
import sys
import zlib

sys.stdout.reconfigure(encoding="utf-8")


def leer_png(ruta):
    datos = open(ruta, "rb").read()
    pos, idat, ancho, alto, tipo = 8, b"", 0, 0, 0
    while pos < len(datos):
        n = struct.unpack(">I", datos[pos:pos + 4])[0]
        tipo_trozo = datos[pos + 4:pos + 8]
        trozo = datos[pos + 8:pos + 8 + n]
        if tipo_trozo == b"IHDR":
            ancho, alto, prof, tipo = struct.unpack(">IIBB", trozo[:10])
        elif tipo_trozo == b"IDAT":
            idat += trozo
        pos += 12 + n
    canales = {2: 3, 6: 4}[tipo]
    crudo = zlib.decompress(idat)
    paso = ancho * canales
    filas, anterior = [], bytearray(paso)
    i = 0
    for _ in range(alto):
        f = crudo[i]
        linea = bytearray(crudo[i + 1:i + 1 + paso])
        i += 1 + paso
        for x in range(paso):
            a = linea[x - canales] if x >= canales else 0
            b = anterior[x]
            c = anterior[x - canales] if x >= canales else 0
            if f == 1:
                linea[x] = (linea[x] + a) & 255
            elif f == 2:
                linea[x] = (linea[x] + b) & 255
            elif f == 3:
                linea[x] = (linea[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                linea[x] = (linea[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        filas.append(bytes(linea))
        anterior = linea
    return ancho, alto, canales, filas


CARPETA = os.path.join(os.environ.get("TEMP", "."), "runnear_pruebas")
a_dir, b_dir = (os.path.join(CARPETA, "reg_" + n) for n in sys.argv[1:3])
for nombre in sorted(os.listdir(a_dir)):
    if not nombre.endswith(".png") or not os.path.exists(os.path.join(b_dir, nombre)):
        continue
    w1, h1, c1, f1 = leer_png(os.path.join(a_dir, nombre))
    w2, h2, c2, f2 = leer_png(os.path.join(b_dir, nombre))
    if (w1, h1) != (w2, h2):
        print(f"{nombre}: tamaño distinto {w1}x{h1} / {w2}x{h2}")
        continue
    distintos, caja = 0, [w1, h1, 0, 0]
    for y in range(h1):
        if f1[y] == f2[y]:
            continue
        for x in range(w1):
            if f1[y][x * c1:x * c1 + 3] != f2[y][x * c2:x * c2 + 3]:
                distintos += 1
                caja = [min(caja[0], x), min(caja[1], y), max(caja[2], x), max(caja[3], y)]
    pct = 100 * distintos / (w1 * h1)
    print(f"{nombre}: {'IGUAL' if not distintos else f'{pct:.2f} % distinto en x{caja[0]}-{caja[2]} y{caja[1]}-{caja[3]}'}")
