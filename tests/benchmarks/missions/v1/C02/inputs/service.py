"""Public HTTP wrapper; select_items is the implementation under repair."""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit, parse_qs
spec = importlib.util.spec_from_file_location('catalog', Path(__file__).with_name('catalog.py'))
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)
select_items = catalog.select_items

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--data', required=True)
    args = parser.parse_args()
    with open(args.data, encoding='utf-8') as handle:
        records = json.load(handle)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            url = urlsplit(self.path)
            status, body = 200, {'ok': True}
            if url.path == '/api/items':
                try:
                    body = select_items(copy.deepcopy(records), parse_qs(url.query, keep_blank_values=True))
                except ValueError:
                    status, body = 400, {'error': 'invalid query'}
                except Exception:
                    status, body = 500, {'error': 'implementation failed'}
            elif url.path != '/health':
                status, body = 404, {'error': 'not found'}
            encoded = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = HTTPServer(('127.0.0.1', args.port), Handler)
    print(json.dumps({'port': server.server_port}), flush=True)
    server.serve_forever()

if __name__ == '__main__':
    main()
