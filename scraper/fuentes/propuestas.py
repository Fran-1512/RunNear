"""
Carreras propuestas por los usuarios de RunNear (organizadores y corredores) y aprobadas
por el administrador en Supabase (tabla "propuestas", vista "propuestas_aprobadas").

Es la única fuente que no depende de otras webs: los datos los da su propio autor.
"""

import json
import urllib.request

from ..comun import USER_AGENT, normalizar_provincia

NOMBRE = "Propuestas de usuarios de RunNear"
URL_BASE = "https://gorunnear.com/"
SUPABASE_URL = "https://fndytkkukhmijrrikjyw.supabase.co"
# Clave pública (la misma que usa la web): la vista solo muestra las propuestas aprobadas
SUPABASE_CLAVE = "sb_publishable_MKC7ayO7IWHaAqPMtzFOBw_TP0pCSdT"


def obtener_carreras():
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/propuestas_aprobadas?select=*",
        headers={"apikey": SUPABASE_CLAVE, "Authorization": f"Bearer {SUPABASE_CLAVE}", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        filas = json.loads(resp.read().decode("utf-8"))

    carreras = []
    for p in filas:
        provincia = normalizar_provincia(p.get("provincia"))
        if not provincia:
            continue
        distancias = sorted({round(float(d), 3) for d in p.get("distancias_km") or [] if 0 < float(d) < 400})
        carrera = {
            "id": f"rn-{p['id']}",
            "nombre": p["nombre"].strip(),
            "tipo": p["tipo"],
            "fecha": p["fecha"],
            "municipio": p["municipio"].strip(),
            "provincia": provincia,
            "distancia_km": max(distancias) if distancias else None,
            "distancias_km": distancias,
            "url_oficial": p["url_oficial"],
            "fuente": {"nombre": NOMBRE, "url": URL_BASE},
        }
        if p.get("hora"):
            carrera["hora"] = p["hora"]
        if p.get("precio_desde") is not None:
            carrera["precio_desde"] = float(p["precio_desde"])
        if p.get("descripcion"):
            carrera["descripcion"] = p["descripcion"].strip()
        if p.get("organizador"):
            carrera["verificada_organizador"] = True
        # Ubicación buscada al enviar la propuesta (si no, se geocodifica por el pueblo)
        if p.get("lat") is not None and p.get("lng") is not None:
            carrera["ubicacion"] = {"lat": round(float(p["lat"]), 5), "lng": round(float(p["lng"]), 5)}
        carreras.append(carrera)
    return carreras
