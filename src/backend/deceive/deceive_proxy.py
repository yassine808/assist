"""Coordinates the ConfigProxy and ChatProxy lifecycle.

Mirrors the Godot DeceiveProxy (src/presence/deceive_proxy.gd): starts the chat
proxy first, wires its discovered via config proxy to the chat upstream, then
starts the config proxy pointing chat at the local chat port.
"""

from . import chat_proxy as chat_proxy_mod
from . import config_proxy as config_proxy_mod

import sys


def print(*args, **kwargs):  # noqa: A001  route logs to stderr; stdout carries the IPC channel
    sys.stderr.write(' '.join(str(a) for a in args) + '\n')
    sys.stderr.flush()



class DeceiveProxy:
    """Owns the ConfigProxy HTTP server and ChatProxy TLS bridge."""

    def __init__(self):
        self._config_proxy = config_proxy_mod.ConfigProxy()
        self._chat_proxy = chat_proxy_mod.ChatProxy()
        self._is_running = False
        self._config_proxy.set_chat_host_discovered_callback(
            self._on_chat_host_discovered
        )

    def _on_chat_host_discovered(self, host, port):
        self._chat_proxy.set_upstream_target(host, port)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self):
        """Start both proxies. Returns (ok, error_message)."""
        if self._is_running:
            return True, ""

        ok, err = self._chat_proxy.start()
        if not ok:
            print(f"[Presence/DeceiveProxy] Failed to start ChatProxy. Error: {err}")
            return False, err

        chat_port = self._chat_proxy.get_port()

        ok, err = self._config_proxy.start(chat_port)
        if not ok:
            print(f"[Presence/DeceiveProxy] Failed to start ConfigProxy. Error: {err}")
            self._chat_proxy.stop()
            return False, err

        self._is_running = True
        print(
            f"[Presence/DeceiveProxy] Both proxies started successfully. Config: {self.get_config_port()}, Chat: {chat_port}"
        )
        return True, ""

    def stop(self):
        if not self._is_running:
            return
        self._config_proxy.stop()
        self._chat_proxy.stop()
        self._is_running = False
        print("[Presence/DeceiveProxy] Both proxies stopped.")

    # ------------------------------------------------------------------
    # Accessors
    # ------------------------------------------------------------------

    def get_config_port(self):
        return self._config_proxy.get_port()

    def get_chat_port(self):
        return self._chat_proxy.get_port()

    def is_running(self):
        return self._is_running
