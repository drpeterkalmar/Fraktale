#!/usr/bin/env python3
"""Lokaler Testserver für die E2E-Tests (Ersatz für `python3 -m http.server 8472`).

`python3 -m http.server` nimmt nur 5 wartende Verbindungen an (socketserver.request_queue_size). Seit 6.5.4 lädt die
Seite 12 Skripte plus Bilder und Worker gleichzeitig – gelegentlich lief die Warteschlange über, ein Skript kam mit
net::ERR_SOCKET_NOT_CONNECTED nicht an und die App startete nicht („App kam nicht hoch“). Hier: Warteschlange 128,
ein Thread je Anfrage, keine Zwischenspeicherung im Browser (Cache-Control: no-store), leises Protokoll.
Aufruf: python3 tools/serve.py [port]   (Standard 8472, Wurzel = Projektordner)
"""
import os, sys, socket, contextlib, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True
    address_family = socket.AF_INET6          # wie `python3 -m http.server`: IPv6 und IPv4 (localhost -> ::1)

    def server_bind(self):
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        # (HTTPServer.server_bind fragt socket.getfqdn() – das hing auf dem Mac mini bis 35 s an der Namensauflösung)
        import socketserver
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name, self.server_port = host, port


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8472
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    Server(('::', port), functools.partial(Handler, directory=root)).serve_forever()
