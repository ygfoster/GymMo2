#!/usr/bin/env python3
"""開発用の静的サーバー。キャッシュ無効 + .webmanifest/.js の正しい MIME タイプ。"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


with Server(('127.0.0.1', PORT), Handler) as httpd:
    print(f'serving on http://127.0.0.1:{PORT}')
    httpd.serve_forever()
