"""Presence masking lifecycle manager (Deceive behavior).

Mirrors the Godot PresenceManager (src/presence/presence_manager.gd): tracks an
AppearOffline lifecycle state, starts/stops the local proxies on demand, and
injects the local config URL into Riot Client launch arguments so the client
redirects its chat through us.
"""

import threading

from . import crypto_helper
from . import deceive_proxy as deceive_proxy_mod
from . import presence_constants as pc

import sys


def print(*args, **kwargs):  # noqa: A001  route logs to stderr; stdout carries the IPC channel
    sys.stderr.write(' '.join(str(a) for a in args) + '\n')
    sys.stderr.flush()


DISABLED = "DISABLED"
STARTING = "STARTING"
READY = "READY"
RUNNING = "RUNNING"
STOPPING = "STOPPING"
FAILED = "FAILED"

STATES = (DISABLED, STARTING, READY, RUNNING, STOPPING, FAILED)


class PresenceManager:
    """Singleton-style manager coordinating the Deceive lifecycle."""

    def __init__(self, config, is_process_running=None):
        self._config = config
        self._is_process_running = is_process_running or (lambda pid: False)
        self._current_state = DISABLED
        self._deceive_proxy = deceive_proxy_mod.DeceiveProxy()
        self._tracked_pid = -1
        self._watch_thread = None
        self._lock = threading.Lock()
        self._watch_interval = pc.PROCESS_POLL_INTERVAL_SEC
        self._stop_watch = threading.Event()

    # ------------------------------------------------------------------
    # State / config
    # ------------------------------------------------------------------

    def is_appear_offline_enabled(self):
        return bool(self._config.get(pc.CONFIG_KEY_APPEAR_OFFLINE, False))

    def get_state(self):
        return self._current_state

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start_proxy(self):
        if not self.is_appear_offline_enabled():
            return False

        if self._current_state in (RUNNING, STARTING, STOPPING):
            self.stop_proxy()
        elif self._current_state == READY:
            return True

        self._set_state(STARTING)
        ok, err = self._deceive_proxy.start()
        if not ok:
            print(f"[Presence/Manager] Failed to start Deceive proxy. Error: {err}")
            self._set_state(FAILED)
            return False

        self._set_state(READY)
        return True

    def stop_proxy(self):
        if self._current_state == DISABLED:
            return
        self._set_state(STOPPING)
        self._deceive_proxy.stop()
        self._stop_watch.set()
        self._tracked_pid = -1
        self._set_state(DISABLED)

    # ------------------------------------------------------------------
    # Client integration
    # ------------------------------------------------------------------

    def get_launch_args(self, base_args):
        """Inject --client-config-url when the proxy is active."""
        args = list(base_args)
        if not self.is_appear_offline_enabled() or self._current_state not in (READY, RUNNING):
            return args
        config_port = self._deceive_proxy.get_config_port()
        if config_port > 0:
            args.append("--client-config-url=http://%s:%d" % (pc.LOCALHOST_IP, config_port))
            print(f"[Presence/Manager] Injected launch argument: --client-config-url=http://{pc.LOCALHOST_IP}:{config_port}")
        return args

    def notify_client_started(self, pid):
        self._tracked_pid = pid
        self._set_state(RUNNING)
        print(f"[Presence/Manager] Tracked Riot Client started with PID: {pid}")
        self._start_watchdog()

    # ------------------------------------------------------------------
    # Getters for the backend handlers
    # ------------------------------------------------------------------

    def get_config_port(self):
        return self._deceive_proxy.get_config_port()

    def get_chat_port(self):
        return self._deceive_proxy.get_chat_port()

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _start_watchdog(self):
        self._stop_watch.set()
        self._stop_watch = threading.Event()
        t = threading.Thread(target=self._watchdog_loop, name="deceive-watchdog", daemon=True)
        t.start()

    def _watchdog_loop(self):
        while not self._stop_watch.wait(self._watch_interval):
            with self._lock:
                state = self._current_state
                pid = self._tracked_pid
            if state != RUNNING:
                break
            if pid > 0 and self._is_process_running(pid):
                continue
            print("[Presence/Manager] No Riot processes detected. Shutting down proxy.")
            self.stop_proxy()
            break

    def _set_state(self, new_state):
        if self._current_state == new_state:
            return
        old_state = self._current_state
        self._current_state = new_state
        print(f"[Presence/Manager] State changed: {old_state} -> {new_state}")

    def cleanup(self):
        self.stop_proxy()
        crypto_helper.CryptoHelper.cleanup()
