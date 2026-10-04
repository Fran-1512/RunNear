"""
Ejecuta todos los adaptadores, une las carreras sin duplicados, geocodifica,
completa detalles (precio, desnivel, inscritos...) y escribe carreras.json.

Uso (desde la carpeta del proyecto):
    py -m scraper.ejecutar
"""

import json
import os
import sys
from datetime import date, timedelta

from . import detalles, fusion, geocodificador
from .fuentes import carrerasclm, carrerasciudadreal, carreraspopulares, dipualba, mayayo, runnea, runninglife

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "carreras.json")
CORRECCIONES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "correcciones.json")
# Días que se conservan las carreras ya celebradas (sección "Resultados")
DIAS_RESULTADOS = 14

# En orden de PRIORIDAD: ante una carrera repetida se conservan los datos de la primera
# fuente y las demás solo completan lo que falte.
ADAPTADORES = [
    carrerasclm,          # calendario regional, el más completo
    dipualba,             # circuitos de la Diputación de Albacete (fuente oficial)
    carrerasciudadreal,   # circuito de Ciudad Real (aporta la hora de salida)
    mayayo,               # calendario federativo de montaña (aporta desniveles)
    carreraspopulares,    # calendario nacional
    runnea,               # calendario nacional
    runninglife,          # calendario regional amplio (aporta coordenadas exactas)
]


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


def main():
    hoy = date.today().isoformat()
    # Se conservan también las carreras recién celebradas, para la sección "Resultados"
    desde = (date.today() - timedelta(days=DIAS_RESULTADOS)).isoformat()
    listas = []

    for adaptador in ADAPTADORES:
        print(f"[{adaptador.NOMBRE}] descargando...")
        try:
            carreras = adaptador.obtener_carreras()
        except Exception as e:
            print(f"[{adaptador.NOMBRE}] ERROR: {e}")
            continue
        futuras = [c for c in carreras if c.get("fecha") and c["fecha"] >= desde and c.get("municipio")]
        print(f"[{adaptador.NOMBRE}] {len(carreras)} carreras, {len(futuras)} próximas o de los últimos {DIAS_RESULTADOS} días")
        if not carreras:
            print(f"[{adaptador.NOMBRE}] AVISO: 0 resultados, revisar el adaptador")
        # Correcciones antes de unir, para que la detección de duplicados use datos buenos
        aplicar_correcciones(futuras)
        listas.append((adaptador.NOMBRE, futuras))

    # Unir fuentes sin duplicados
    unicas, estadisticas = fusion.unir(listas)
    print("Unión de fuentes:")
    for nombre, e in estadisticas.items():
        print(f"  {nombre}: {e['nuevas']} nuevas, {e['ya_existentes']} ya estaban (completadas)")

    # Running.life no da la web oficial: se busca en su ficha (solo carreras nuevas)
    pendientes = [c for c in unicas if c["id"].startswith("rl-") and fusion.es_agregador(c.get("url_oficial"))]
    if pendientes:
        print(f"Buscando la web oficial de {len(pendientes)} carreras de Running.life...")
        for c in pendientes:
            runninglife.completar_web_oficial(c)
        # Con su web ya conocida, alguna resulta ser una carrera que ya teníamos
        unicas, uniones = fusion.unir_por_web(unicas)
        if uniones:
            print(f"  {uniones} de ellas ya estaban con otro nombre (misma web oficial): unidas")

    # Geocodificar por municipio (cacheado) las que no traen coordenadas
    sin_ubicacion = [c for c in unicas if not c.get("ubicacion")]
    print(f"Geocodificando {len({(c['municipio'], c['provincia']) for c in sin_ubicacion})} municipios...")
    sin_coords = []
    resultado = []
    for c in unicas:
        if not c.get("ubicacion"):
            coords = geocodificador.geocodificar(c["municipio"], c["provincia"])
            if not coords:
                sin_coords.append(f"{c['municipio']} ({c['provincia']}) - {c['nombre']}")
                continue
            c["ubicacion"] = coords
        c["actualizado"] = hoy
        c.pop("url_ficha_fuente", None)
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

    # Precio, desnivel, inscritos... desde la web de inscripción de cada carrera (cacheado)
    print("Leyendo precio y desnivel de las webs de inscripción...")
    try:
        detalles.enriquecer(resultado)
    except Exception as e:
        print(f"  [detalles] ERROR (se continúa sin precio/desnivel): {e}")

    # Escritura atómica: el servidor nunca lee un fichero a medio escribir
    resultado.sort(key=lambda c: (c["fecha"], c["nombre"]))
    temporal = SALIDA + ".tmp"
    with open(temporal, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    os.replace(temporal, SALIDA)

    print(f"OK: {len(resultado)} carreras escritas en {SALIDA}")
    return True


if __name__ == "__main__":
    main()
