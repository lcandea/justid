#!/usr/bin/env python3
"""Dev server: serves the repository root without caching and prints a URL for your phone.

Usage (from the repo root):  python3 tools/serve.py [port]      (default 8765)
Listens on the whole local network so the app can be opened from a phone on the same wifi.
It only serves static files; the app never sends anything back to it.
"""
import http.server
import os
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    # .js must be served as JavaScript for ES modules to load
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # The default listen backlog (5) is too small: a page loads ~15 ES modules at once,
    # and parallel test workers multiply that, so extra connections were being reset.
    request_queue_size = 128
    daemon_threads = True


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # sends nothing; just picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    print(f"Computer: http://localhost:{PORT}/app/")
    print(f"Phone:    http://{lan_ip()}:{PORT}/app/  (same wifi)", flush=True)
    Server(("0.0.0.0", PORT), NoCache).serve_forever()
