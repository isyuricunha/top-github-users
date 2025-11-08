import json
from http.server import BaseHTTPRequestHandler
import os

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            file_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'rankings.json')
            
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            self.send_response(200)
            self.send_header('content-type', 'application/json')
            self.send_header('access-control-allow-origin', '*')
            self.end_headers()
            
            self.wfile.write(json.dumps(data).encode())
            
        except FileNotFoundError:
            self.send_response(404)
            self.send_header('content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'no data available'}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())
