#!/usr/bin/env python3
"""開発用の静的サーバー（web/ を配信）。キャッシュ無効 + .webmanifest/.js の正しい MIME タイプ。
API（/api）は持たないので、ローカルでは ?demo のデモモードで確認する。本番の API は Cloudflare Worker（worker/）。"""
import functools
import http.server
import os
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


WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')

with Server(('127.0.0.1', PORT), functools.partial(Handler, directory=WEB_DIR)) as httpd:
    print(f'serving on http://127.0.0.1:{PORT}')
    httpd.serve_forever()
