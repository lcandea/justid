#!/usr/bin/env python3
"""Servidor de desarrollo: sirve esta carpeta sin caché y muestra la URL para el móvil.

Uso: python3 serve.py [puerto]      (por defecto 8765)
Escucha en toda la red local para poder abrirlo desde el móvil en la misma wifi.
Solo sirve archivos estáticos; la app no envía nada al servidor.
"""
import http.server, os, socket, sys

import build_templates

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Las plantillas de js/templates/ se empaquetan al vuelo: añade un .json y recarga.
        if self.path.split("?")[0] == "/js/templates.js":
            build_templates.build(quiet=True)
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no envía nada; solo elige la interfaz
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    print("Plantillas:")
    build_templates.build()
    print(f"PC:    http://localhost:{PORT}")
    print(f"Móvil: http://{lan_ip()}:{PORT}  (misma wifi)", flush=True)
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoCache).serve_forever()
