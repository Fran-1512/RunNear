"""
Ejecuta todos los adaptadores, geocodifica, deduplica y escribe carreras.json.

Uso (desde la carpeta del proyecto):
    py -m scraper.ejecutar
"""

import json
import os
import sys
from datetime import date

from . import detalles, geocodificador
from .fuentes import carrerasclm

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "carreras.json")
CORRECCIONES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "correcciones.json")


def aplicar_correcciones(carreras):
    """Sobrescribe campos erróneos de las fuentes con scraper/correcciones.json."""
    if not os.path.exists(CORRECCIONES):
        return
    with open(CORRECCIONES, "r", encoding="utf-8") as f:
        correcciones = json.load(f)
    for c in carreras:
        for campo, valor in correcciones.get(c["id"], {}).items():
            if not campo.startswith("_"):
                c[campo] = valor

ADAPTADORES = [carrerasclm]


def _clave_duplicado(c):
    """Misma fecha + mismo municipio + nombre muy parecido = misma carrera."""
    nombre = "".join(ch for ch in c["nombre"].lower() if ch.isalnum())
    return (c["fecha"], c["municipio"].lower(), nombre[:25])


def main():
    hoy = date.today().isoformat()
    todas = []

    for adaptador in ADAPTADORES:
        print(f"[{adaptador.NOMBRE}] descargando...")
        try:
            carreras = adaptador.obtener_carreras()
        except Exception as e:
            print(f"[{adaptador.NOMBRE}] ERROR: {e}")
            continue
        futuras = [c for c in carreras if c["fecha"] >= hoy]
        print(f"[{adaptador.NOMBRE}] {len(carreras)} carreras a pie, {len(futuras)} futuras")
        if not carreras:
            print(f"[{adaptador.NOMBRE}] AVISO: 0 resultados, revisar el adaptador")
        todas.extend(futuras)

    # Antes de deduplicar y geocodificar, para que usen los datos ya corregidos
    aplicar_correcciones(todas)

    # Deduplicar entre fuentes (se queda la primera)
    vistas = set()
    unicas = []
    for c in todas:
        clave = _clave_duplicado(c)
        if clave in vistas:
            continue
        vistas.add(clave)
        unicas.append(c)

    # Geocodificar por municipio (cacheado)
    print(f"Geocodificando {len({(c['municipio'], c['provincia']) for c in unicas})} municipios...")
    sin_coords = []
    resultado = []
    for c in unicas:
        coords = geocodificador.geocodificar(c["municipio"], c["provincia"])
        if not coords:
            sin_coords.append(f"{c['municipio']} ({c['provincia']}) - {c['nombre']}")
            continue
        c["ubicacion"] = coords
        c["actualizado"] = hoy
        resultado.append(c)
    geocodificador.guardar_cache()

    if sin_coords:
        print(f"Sin coordenadas ({len(sin_coords)}), descartadas:")
        for s in sin_coords:
            print(f"  - {s}")

    # Si todas las fuentes fallaron, conservar los datos anteriores en vez de vaciar la app
    if not resultado:
        print("AVISO: 0 carreras obtenidas; se conserva el carreras.json actual.")
        return False

    # Precio y desnivel desde la web de inscripción de cada carrera (cacheado semanalmente)
    print("Leyendo precio y desnivel de las webs de inscripción...")
    try:
        detalles.enriquecer(resultado)
    except Exception as e:
        print(f"  [detalles] ERROR (se continúa sin precio/desnivel): {e}")

    # Escritura atómica: el servidor nunca lee un fichero a medio escribir
    resultado.sort(key=lambda c: c["fecha"])
    temporal = SALIDA + ".tmp"
    with open(temporal, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    os.replace(temporal, SALIDA)

    print(f"OK: {len(resultado)} carreras escritas en {SALIDA}")
    return True


if __name__ == "__main__":
    main()
