#!/usr/bin/env python3
"""FDC 本地验证桩：静态服务 public/，/devices 返回固定两台设备（延迟 700ms 以便截骨架屏）。
仅本地验证用，不参与部署。
端口可用环境变量 FDC_PORT 覆盖（默认 8099）。"""
import json
import os
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PORT = int(os.environ.get("FDC_PORT", "8099"))
NOW = int(time.time() * 1000)
DEVICES = {
    "devices": [
        {
            "device_id": "mus4-esp",
            "type": "esp32",
            "lan_ip": "192.168.1.46",
            "port": 80,
            "hostname": "mus4-esp",
            "version": "v1.8.78",
            "model": "",
            "os": "",
            "state": "online",
            "last_seen_epoch_ms": NOW - 20000,
            "online": True,
        },
        {
            "device_id": "dev-host",
            "type": "dd",
            "lan_ip": "192.168.1.20",
            "port": 8000,
            "hostname": "dev-host",
            "version": "v10.2.3",
            "model": "ADL-N",
            "os": "Ubuntu 26.04 LTS",
            "state": "online",
            "last_seen_epoch_ms": NOW - 40000,
            "online": True,
        },
    ]
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def do_GET(self):
        if self.path == "/devices":
            time.sleep(0.7)
            body = json.dumps(DEVICES).encode()
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
    print(f"serving {PUBLIC} on http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
