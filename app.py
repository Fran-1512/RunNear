#!/usr/bin/env python3
"""
Servidor Backend REST & Servidor Web para la Aplicación de Carreras
Soporta cálculo geoespacial (fórmula de Haversine), filtrado dinámico y persistencia.
Usa únicamente la biblioteca estándar de Python (sin dependencias externas requeridas).
"""

import http.server
import socketserver
import urllib.parse
import json
import math
import os
import sys
import threading
import time
from datetime import date, datetime, timedelta

# Asegurar compatibilidad de salida UTF-8 en consola de Windows
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PORT = 8000
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "carreras.json")
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

# Cada cuántas horas se vuelve a ejecutar el scraper en segundo plano
INTERVALO_ACTUALIZACION_H = 24

def actualizar_carreras_periodicamente():
    """Ejecuta el scraper al arrancar y luego cada INTERVALO_ACTUALIZACION_H horas."""
    from scraper import ejecutar
    while True:
        print(f"[auto] Actualizando carreras ({datetime.now():%Y-%m-%d %H:%M})...")
        try:
            ejecutar.main()
        except Exception as e:
            # Un fallo del scraper nunca debe tumbar el servidor
            print(f"[auto] ERROR actualizando carreras: {e}")
        time.sleep(INTERVALO_ACTUALIZACION_H * 3600)

def haversine(lat1, lon1, lat2, lon2):
    """Calcula la distancia de círculo máximo entre dos puntos en km."""
    R = 6371.0  # Radio medio de la Tierra en km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 1)

def cargar_carreras():
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[ERROR] Error al leer {DATA_FILE}: {e}")
        return []

def guardar_carreras(carreras):
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(carreras, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[ERROR] Error al guardar {DATA_FILE}: {e}")
        return False

class CarrerasRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def end_headers(self):
        # El código de la página se revalida siempre, para que una actualización llegue sin
        # tener que forzar la recarga; las teselas del mapa sí se pueden cachear
        if self.path.split("?")[0].endswith((".js", ".css", ".html", "/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        # Las teselas del mapa se piden por cientos: no llenar la consola con ellas
        if "/mapa/teselas/" in self.path:
            return
        super().log_message(format, *args)

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Rutas de API
        if path == "/api/carreras":
            self.handle_get_carreras(query)
            return
        elif path.startswith("/api/carreras/"):
            carrera_id = path.replace("/api/carreras/", "").strip()
            self.handle_get_carrera_by_id(carrera_id)
            return
        elif path == "/api/stats":
            self.handle_get_stats()
            return

        # Archivos estáticos
        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/carreras":
            self.handle_post_carrera()
            return
        self.send_error(404, "Endpoint no encontrado")

    def handle_get_stats(self):
        carreras = cargar_carreras()
        populares = sum(1 for c in carreras if c.get("tipo") == "popular")
        trails = sum(1 for c in carreras if c.get("tipo") == "trail")
        self._send_json({
            "total": len(carreras),
            "populares": populares,
            "trails": trails,
            "fecha_sistema": datetime.now().strftime("%Y-%m-%d")
        })

    def handle_get_carrera_by_id(self, carrera_id):
        carreras = cargar_carreras()
        for c in carreras:
            if c.get("id") == carrera_id:
                self._send_json(c)
                return
        self._send_json({"error": "Carrera no encontrada"}, status=404)

    def handle_get_carreras(self, query):
        carreras = cargar_carreras()

        # Coordenadas de referencia
        user_lat = None
        user_lng = None
        try:
            if "lat" in query and "lng" in query:
                user_lat = float(query["lat"][0])
                user_lng = float(query["lng"][0])
        except (ValueError, IndexError):
            pass

        # Radio máximo en km (opcional)
        radio_km = None
        try:
            if "radio_km" in query and query["radio_km"][0]:
                val = float(query["radio_km"][0])
                if val > 0:
                    radio_km = val
        except (ValueError, IndexError):
            pass

        # Tipo (popular, trail o todas)
        tipo = query.get("tipo", ["todas"])[0].lower()

        # Rango de distancia en km (corta, media, larga, ultra)
        distancia_filtro = query.get("distancia", ["todas"])[0].lower()

        # Texto de búsqueda
        search_q = query.get("q", [""])[0].strip().lower()

        # Ordenación ('distancia', 'fecha', 'km')
        orden = query.get("orden", ["distancia"])[0].lower()

        hace_14_dias = (date.today() - timedelta(days=14)).isoformat()
        resultados = []
        for c in carreras:
            # Quitar las celebradas hace más de 14 días (las recientes se usan en "Resultados";
            # la página ya oculta las pasadas en el resto de secciones)
            if c.get("fecha") and c["fecha"] < hace_14_dias:
                continue

            # Cálculo de distancia al usuario
            c_lat = c.get("ubicacion", {}).get("lat")
            c_lng = c.get("ubicacion", {}).get("lng")
            dist_usuario = None

            if user_lat is not None and user_lng is not None and c_lat is not None and c_lng is not None:
                dist_usuario = haversine(user_lat, user_lng, c_lat, c_lng)
                c["distancia_usuario_km"] = dist_usuario
            else:
                c["distancia_usuario_km"] = None

            # Filtro por radio
            if radio_km is not None and dist_usuario is not None:
                if dist_usuario > radio_km:
                    continue

            # Filtro por tipo
            if tipo != "todas" and c.get("tipo") != tipo:
                continue

            # Filtro por longitud: basta con que una de sus distancias encaje
            if distancia_filtro != "todas":
                lista_km = c.get("distancias_km") or (
                    [c["distancia_km"]] if c.get("distancia_km") is not None else [])
                rangos = {
                    "corta": lambda km: km <= 10,
                    "media": lambda km: 10 < km <= 21.5,
                    "larga": lambda km: 21.5 < km <= 43,
                    "ultra": lambda km: km > 43,
                }
                encaja = rangos.get(distancia_filtro, lambda km: True)
                if not any(encaja(float(km)) for km in lista_km):
                    continue

            # Búsqueda por texto (nombre, municipio, provincia)
            if search_q:
                nombre = c.get("nombre", "").lower()
                muni = c.get("municipio", "").lower()
                prov = c.get("provincia", "").lower()
                desc = c.get("descripcion", "").lower()
                if (search_q not in nombre and search_q not in muni and
                    search_q not in prov and search_q not in desc):
                    continue

            resultados.append(c)

        # Ordenación
        if orden == "distancia" and user_lat is not None:
            resultados.sort(key=lambda x: (x.get("distancia_usuario_km") is None, x.get("distancia_usuario_km") or 0))
        elif orden == "fecha":
            resultados.sort(key=lambda x: x.get("fecha", "9999-99-99"))
        elif orden == "km":
            resultados.sort(key=lambda x: (x.get("distancia_km") is None, x.get("distancia_km") or 0))
        elif orden == "desnivel":
            resultados.sort(key=lambda x: int(x.get("desnivel_positivo_m") or 0), reverse=True)

        self._send_json({
            "total": len(resultados),
            "filtros_aplicados": {
                "user_lat": user_lat,
                "user_lng": user_lng,
                "radio_km": radio_km,
                "tipo": tipo,
                "distancia": distancia_filtro,
                "q": search_q,
                "orden": orden
            },
            "carreras": resultados
        })

    def handle_post_carrera(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)
        try:
            nueva = json.loads(post_data.decode("utf-8"))
        except Exception:
            self._send_json({"error": "JSON no válido"}, status=400)
            return

        # Validaciones mínimas
        nombre = nueva.get("nombre", "").strip()
        tipo = nueva.get("tipo", "popular")
        fecha = nueva.get("fecha", "")
        ubicacion = nueva.get("ubicacion", {})

        if not nombre or not fecha or "lat" not in ubicacion or "lng" not in ubicacion:
            self._send_json({"error": "Faltan campos obligatorios: nombre, fecha, latitud, longitud"}, status=400)
            return

        carreras = cargar_carreras()
        nueva_id = f"car-{len(carreras) + 1:03d}"
        nueva["id"] = nueva_id

        # Asegurar formato estándar
        if not nueva.get("url_oficial"):
            nueva["url_oficial"] = "https://ejemplo-ficticio-registro.com"

        carreras.append(nueva)
        if guardar_carreras(carreras):
            self._send_json({"mensaje": "Carrera creada con éxito", "carrera": nueva}, status=201)
        else:
            self._send_json({"error": "No se pudo guardar la carrera"}, status=500)

def run():
    # Hilo daemon: se detiene solo al cerrar el servidor
    threading.Thread(target=actualizar_carreras_periodicamente, daemon=True).start()

    handler = CarrerasRequestHandler
    # Permitir reutilizar dirección si se reinicia rápidamente
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print("=" * 65)
        print(f"  🏃 RUNMAP - Servidor de Carreras & Geolocalización Activo")
        print(f"  URL Local: http://localhost:{PORT}")
        print(f"  API:       http://localhost:{PORT}/api/carreras")
        print("=" * 65)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nDeteniendo servidor...")
            httpd.server_close()

if __name__ == "__main__":
    run()
