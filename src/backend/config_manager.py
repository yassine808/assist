"""Persistent key/value app configuration.

Replaces the Godot ConfigManager (user://data/configs.json). Lives next to the
profile database in the workspace data directory.
"""

import json
import os
import threading


class ConfigManager:
    """Thread-safe JSON-backed settings store.

    Only the keys referenced by the app are persisted. Unknown keys are kept in
    memory so a future renderer never silently loses data it wrote.
    """

    def __init__(self, path):
        self._path = path
        self._lock = threading.RLock()
        self._defaults = {
            # Absolute folder containing RiotClientServices.exe.
            "RiotClientLocation": "",
            # "riot" (client only) or "valorant" (auto-launch VALORANT).
            "LaunchProduct": "valorant",
            # Shared game-settings sync toggle.
            "SyncGameSettings": False,
            # Source of shared game settings (profile directory name).
            "SharedSettingsSourceDirectory": "",
            # Backwards-compatible source profile name.
            "SharedSettingsSourceProfile": "",
            # Profile the app believes is currently running (for adoption).
            "LastRunningProfile": "",
        }
        self._values = dict(self._defaults)
        self._load()

    def _load(self):
        if not os.path.exists(self._path):
            return
        try:
            with open(self._path, "r", encoding="utf-8") as fh:
                stored = json.load(fh)
            if isinstance(stored, dict):
                self._values.update(stored)
        except (OSError, ValueError):
            # Corrupt config: keep the in-memory defaults; never crash on boot.
            pass

    def save(self):
        """Persist config to disk. Returns True on success."""
        with self._lock:
            try:
                with open(self._path, "w", encoding="utf-8") as fh:
                    json.dump(self._values, fh, indent=2, ensure_ascii=False)
                return True
            except OSError:
                return False

    def get(self, key, default=None):
        with self._lock:
            return self._values.get(key, default)

    def set(self, key, value):
        """Set a value in memory and persist. Returns True on success."""
        with self._lock:
            self._values[key] = value
            return self.save()

    def set_many(self, items):
        """Apply several key/value pairs and persist once. Returns True on success."""
        with self._lock:
            self._values.update(items)
            return self.save()

    def all(self):
        """Return a shallow copy of every known setting."""
        with self._lock:
            return dict(self._values)
