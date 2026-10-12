#!/usr/bin/env python3
"""
Servidor local para ver RunNear en el ordenador: http://localhost:8000

Sirve los archivos del proyecto tal cual, igual que GitHub Pages en la web publicada.
Las carreras las actualiza GitHub cada día (scraper); para regenerarlas a mano:
    py -m scraper.ejecutar     (carreras.json)
    py -m sitio.generar        (portada, fichas, calendarios, guías y sitemap)
"""

import http.server
import os
import socketserver
import sys

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PUERTO = 8000
CARPETA = os.path.dirname(os.path.abspath(__file__))


class Manejador(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=CARPETA, **kwargs)

    def end_headers(self):
        # El código de la página se revalida siempre, para ver cada cambio sin forzar la
        # recarga; las teselas del mapa sí se pueden guardar en caché
        if self.path.split("?")[0].endswith((".js", ".css", ".html", ".json", "/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        # Las teselas del mapa se piden por cientos: no llenar la consola con ellas
        if "/mapa/teselas/" not in self.path:
            super().log_message(format, *args)


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PUERTO), Manejador) as servidor:
        print(f"RunNear en http://localhost:{PUERTO}  (Ctrl+C para parar)")
        try:
            servidor.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor parado")


if __name__ == "__main__":
    main()
