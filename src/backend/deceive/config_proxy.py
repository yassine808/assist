"""Local HTTP config proxy that patches Riot client configuration responses.

Mirrors the Godot ConfigProxy (src/presence/config_proxy.gd): a local HTTP
server on 127.0.0.1 that forwards configuration requests to Riot's client
config endpoint and rewrites the returned JSON so the Riot client connects its
chat through our local ChatProxy (port substitution + host pinning).
"""

import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import presence_constants as pc

import sys


def print(*args, **kwargs):  # noqa: A001  route logs to stderr; stdout carries the IPC channel
    sys.stderr.write(' '.join(str(a) for a in args) + '\n')
    sys.stderr.flush()



class ConfigProxy:
    """HTTP server that intercepts Riot client configuration requests."""

    def __init__(self):
        self._target_chat_port = 0
        self._httpd = None
        self._thread = None
        self._chat_host_callback = None

    # ------------------------------------------------------------------
    # Configuration / lifecycle
    # ------------------------------------------------------------------

    def set_chat_host_discovered_callback(self, callback):
        """callback(host, port) fires when the upstream chat host is learned."""
        self._chat_host_callback = callback

    def start(self, target_chat_port):
        """Bind an ephemeral loopback port. Returns (ok, error_message)."""
        self._target_chat_port = int(target_chat_port)
        handler = self._make_handler()
        try:
            self._httpd = ThreadingHTTPServer((pc.LOCALHOST_IP, 0), handler)
        except OSError as exc:
            return False, str(exc)

        self._thread = threading.Thread(
            target=self._httpd.serve_forever,
            name="deceive-config-proxy",
            daemon=True,
        )
        self._thread.start()
        print(
            f"[Presence/ConfigProxy] HTTP Config Server listening on {pc.LOCALHOST_IP}:{self.get_port()} "
            f"(forwarding to ChatProxy port {self._target_chat_port})"
        )
        return True, ""

    def stop(self):
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
            print("[Presence/ConfigProxy] Stopped listening.")

    def get_port(self):
        return self._httpd.server_address[1] if self._httpd is not None else 0

    # ------------------------------------------------------------------
    # Request handling
    # ------------------------------------------------------------------

    def _make_handler(self):
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt, *args):  # silence default stderr logging
                pass

            def do_GET(self):
                proxy._handle_request(
                    self.path, dict(self.headers.items()), self
                )

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length > 0 else b""
                proxy._handle_request(self.path, dict(self.headers.items()), self, body=body)

        return Handler

    def _handle_request(self, raw_path, headers, respond, body=b""):
        # Sanitize path: strip absolute URL scheme/host if proxy-style.
        path = raw_path
        if path.startswith("http://") or path.startswith("https://"):
            scheme_end = path.find("://") + 3
            slash_pos = path.find("/", scheme_end)
            path = path[slash_pos:] if slash_pos != -1 else "/"

        target_url = pc.RIOT_CLIENT_CONFIG_BASE_URL + path
        print(f"[Presence/ConfigProxy] Intercepted {raw_path} -> Forwarding to {target_url}")

        # Forward relevant headers (mirror Godot: drop Host/Connection, force ours).
        forwarded = {}
        for key, value in headers.items():
            lower = key.lower()
            if lower in ("host", "connection", "content-length", "accept-encoding"):
                continue
            forwarded[key] = value
        forwarded["Host"] = "clientconfig.rpg.riotgames.com"
        forwarded["Connection"] = "close"

        request = urllib.request.Request(
            target_url,
            data=body or None,
            headers=forwarded,
            method="POST" if body else "GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as resp:
                response_code = resp.status
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            response_code = exc.code
            raw = exc.read()
        except (urllib.error.URLError, OSError) as exc:
            print(f"[Presence/ConfigProxy] Upstream request failed: {exc}")
            respond.send_error(502, "Bad Gateway")
            return

        self._send_response(respond, response_code, raw)

    def _send_response(self, respond, status_code, raw_body):
        body = raw_body
        content_type = "application/json"
        try:
            config = json.loads(raw_body)
            if isinstance(config, dict):
                self._patch_client_config(config)
                body = json.dumps(config).encode("utf-8")
        except (ValueError, TypeError):
            # Not JSON: forward raw body intact.
            content_type = "application/octet-stream"

        respond.send_response(status_code)
        respond.send_header("Content-Type", content_type)
        respond.send_header("Content-Length", str(len(body)))
        respond.send_header("Connection", "close")
        respond.send_header("Access-Control-Allow-Origin", "*")
        respond.end_headers()
        if body:
            respond.wfile.write(body)

    def _patch_client_config(self, config):
        # 1. Extract original regional chat host before patching.
        orig_host = ""
        orig_port = pc.DEFAULT_RIOT_CHAT_PORT
        if isinstance(config.get("chat.host"), str):
            orig_host = config["chat.host"]
        if isinstance(config.get("chat.port"), (int, float)):
            orig_port = int(config["chat.port"])

        if (
            orig_host
            and orig_host != pc.DECEIVE_LOCALHOST_DOMAIN
            and orig_host != pc.LOCALHOST_IP
        ):
            print(f"[Presence/ConfigProxy] Discovered upstream Riot chat host: {orig_host}:{orig_port}")
            if self._chat_host_callback:
                self._chat_host_callback(orig_host, orig_port)

        # 2. Patch top-level chat properties to point to the local proxy.
        config["chat.host"] = pc.DECEIVE_LOCALHOST_DOMAIN
        config["chat.port"] = self._target_chat_port
        config["chat.allow_bad_cert.enabled"] = True
        config["chat.use_tls.enabled"] = True

        # 3. Patch chat affinities to force local connection.
        affinities = config.get("chat.affinities")
        if isinstance(affinities, dict):
            for key in list(affinities.keys()):
                affinities[key] = pc.DECEIVE_LOCALHOST_DOMAIN

        print(f"[Presence/ConfigProxy] Successfully patched Riot Client Config with local ChatProxy port {self._target_chat_port}.")
