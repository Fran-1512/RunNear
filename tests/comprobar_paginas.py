"""
Comprueba las páginas generadas (py -m sitio.generar) antes de publicarlas:
  - que ningún enlace o recurso interno apunte a un archivo que no existe;
  - que los datos estructurados para Google (JSON-LD) sean JSON válido;
  - que no haya dos páginas con el mismo título;
  - que ningún enlace use "javascript:" (podría ejecutar código).
Termina con error si encuentra algún problema, para que GitHub no publique la web rota.

    py tests/comprobar_paginas.py
"""

import glob
import json
import os
import re
import sys
from collections import Counter
from urllib.parse import unquote, urljoin, urlparse

if sys.platform.startswith("win"):
    sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARPETAS = ("carrera", "calendario", "guias", "sobre-runnear", "contacto", "cookies")
SUELTAS = ("index.html", "mapa.html", "legal.html")


def paginas():
    for carpeta in CARPETAS:
        yield from glob.glob(os.path.join(RAIZ, carpeta, "**", "index.html"), recursive=True)
    for nombre in SUELTAS:
        yield os.path.join(RAIZ, nombre)


def main():
    problemas, titulos, total = [], Counter(), 0
    for ruta in paginas():
        total += 1
        relativa = os.path.relpath(ruta, RAIZ).replace("\\", "/")
        texto = open(ruta, encoding="utf-8").read()
        base = "http://local/" + relativa

        for bloque in re.findall(r'<script type="application/ld\+json">(.*?)</script>', texto, re.S):
            try:
                json.loads(bloque)
            except ValueError as error:
                problemas.append(f"{relativa}: JSON-LD inválido ({error})")

        titulo = re.search(r"<title>(.*?)</title>", texto, re.S)
        if titulo:
            titulos[titulo.group(1)] += 1

        for enlace in re.findall(r'(?:href|src)="([^"]+)"', texto):
            enlace = enlace.replace("&amp;", "&")
            if enlace.strip().lower().startswith("javascript:"):
                problemas.append(f"{relativa}: enlace javascript: ({enlace[:60]})")
                continue
            destino = urlparse(urljoin(base, enlace))
            if destino.netloc != "local":
                continue
            camino = unquote(destino.path.lstrip("/"))
            archivo = os.path.join(RAIZ, camino, "index.html") if camino.endswith("/") or not camino \
                else os.path.join(RAIZ, camino)
            if not os.path.exists(archivo):
                problemas.append(f"{relativa}: enlace roto -> {camino}")

    problemas += [f"título repetido en {n} páginas: {t}" for t, n in titulos.items() if n > 1]
    print(f"{total} páginas revisadas, {len(problemas)} problemas")
    for p in problemas[:30]:
        print("  -", p)
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
