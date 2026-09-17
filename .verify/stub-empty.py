#!/usr/bin/env python3
"""FDC 空态验证桩：静态服务 public/，/devices 返回空列表。
仓库常驻、仅本地验证用，不参与部署。端口可用环境变量 FDC_PORT_EMPTY 覆盖（默认 8098）。"""
import json
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PORT = int(os.environ.get("FDC_PORT_EMPTY", "8098"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def do_GET(self):
        if self.path == "/devices":
            body = json.dumps({"devices": []}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"serving {PUBLIC} on http://127.0.0.1:{PORT} (empty /devices)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
