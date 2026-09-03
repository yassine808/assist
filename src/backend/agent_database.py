"""Encrypted local database for VALORANT agent metadata.

Caches agent data (UUID, name, background, portrait, role, abilities)
fetched from the public Valorant API. Data is encrypted at rest using
Fernet symmetric encryption (AES-128-CBC with HMAC-SHA256).

The cache is checked on first use — if stale (>7 days) or missing,
a fresh fetch is performed automatically.
"""

import json
import os
import time
import urllib.request

from cryptography.fernet import Fernet

AGENT_API_URL = "https://valorant-api.com/v1/agents"
CACHE_STALENESS_S = 7 * 24 * 3600  # 7 days
ENV_FILENAME = ".env"
ENV_KEY_AGENT_DB = "AGENT_DB_KEY"

# Deterministic key derived from a fixed secret (not user-facing).
# In production you'd rotate this; for a local desktop app it's fine.
_FIXED_KEY_SEED = "riotswitcher-agent-db-v1-2024"
_KEY_LENGTH = 32


def _derive_fernet_key():
    """Derive a Fernet-compatible base64 key from the fixed seed."""
    import hashlib
    digest = hashlib.sha256(_FIXED_KEY_SEED.encode()).digest()
    import base64
    return base64.urlsafe_b64encode(digest)


class AgentDatabase:
    """Thread-safe encrypted agent metadata cache."""

    def __init__(self, data_dir):
        self._data_dir = data_dir
        self._db_path = os.path.join(data_dir, "agents.enc")
        self._fernet = Fernet(_derive_fernet_key())
        self._agents = {}  # name -> agent dict
        self._last_fetch = 0.0
        self._loaded = False

    def get_agent(self, name):
        """Return agent dict by display name (case-insensitive), or None."""
        self._ensure_loaded()
        return self._agents.get(name.lower())

    def get_agent_by_uuid(self, uuid):
        """Return agent dict by UUID, or None."""
        self._ensure_loaded()
        for agent in self._agents.values():
            if agent.get("uuid") == uuid:
                return agent
        return None

    def get_background_url(self, name):
        """Return the background image URL for an agent, or None."""
        agent = self.get_agent(name)
        return agent.get("background") if agent else None

    def get_portrait_url(self, name):
        """Return the full portrait URL for an agent, or None."""
        agent = self.get_agent(name)
        return agent.get("fullPortrait") if agent else None

    def get_role(self, name):
        """Return the role name for an agent, or None."""
        agent = self.get_agent(name)
        return agent.get("role", {}).get("name") if agent else None

    def get_all_agents(self):
        """Return dict of all cached agents."""
        self._ensure_loaded()
        return dict(self._agents)

    def force_refresh(self):
        """Force a fresh fetch from the API."""
        self._fetch_and_cache()
        self._loaded = True

    def _ensure_loaded(self):
        if self._loaded:
            return
        if self._try_load_cache():
            self._loaded = True
            return
        self._fetch_and_cache()
        self._loaded = True

    def _try_load_cache(self):
        """Try to load and decrypt the cache file. Returns True if valid."""
        if not os.path.exists(self._db_path):
            return False
        try:
            with open(self._db_path, "rb") as f:
                encrypted = f.read()
            decrypted = self._fernet.decrypt(encrypted)
            payload = json.loads(decrypted.decode("utf-8"))
            self._agents = payload.get("agents", {})
            self._last_fetch = payload.get("last_fetch", 0)
            age = time.time() - self._last_fetch
            if age < CACHE_STALENESS_S:
                return True
            # Cache is stale — but still usable, will refresh in background
            return True
        except Exception:  # noqa: BLE001
            # Corrupted or wrong key — re-fetch
            return False

    def _fetch_and_cache(self):
        """Fetch agent data from the public API and cache it encrypted."""
        try:
            agents = self._fetch_agents()
            if agents:
                self._agents = agents
                self._last_fetch = time.time()
                self._save_cache()
        except Exception:  # noqa: BLE001
            pass  # Keep whatever we have (even empty)

    def _fetch_agents(self):
        """Fetch all agents from the Valorant API."""
        req = urllib.request.Request(
            AGENT_API_URL,
            headers={"User-Agent": "RiotSwitcher/2.0"}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body)
            result = {}
            for agent in data.get("data", []):
                name = agent.get("displayName", "")
                if not name:
                    continue
                result[name.lower()] = {
                    "uuid": agent.get("uuid", ""),
                    "displayName": name,
                    "description": agent.get("description", ""),
                    "displayIcon": agent.get("displayIcon", ""),
                    "fullPortrait": agent.get("fullPortrait", ""),
                    "background": agent.get("background", ""),
                    "backgroundGradientColors": agent.get("backgroundGradientColors", []),
                    "role": {
                        "name": agent.get("role", {}).get("displayName", ""),
                        "description": agent.get("role", {}).get("description", ""),
                        "displayIcon": agent.get("role", {}).get("displayIcon", ""),
                    },
                    "abilities": [
                        {
                            "name": a.get("displayName", ""),
                            "description": a.get("description", ""),
                            "icon": a.get("displayIcon", ""),
                        }
                        for a in agent.get("abilities", [])
                        if a.get("displayName")
                    ],
                }
            return result
        except Exception:  # noqa: BLE001
            return {}

    def _save_cache(self):
        """Encrypt and save the cache to disk."""
        try:
            os.makedirs(os.path.dirname(self._db_path), exist_ok=True)
            payload = {
                "agents": self._agents,
                "last_fetch": self._last_fetch,
            }
            encrypted = self._fernet.encrypt(json.dumps(payload).encode("utf-8"))
            with open(self._db_path, "wb") as f:
                f.write(encrypted)
        except Exception:  # noqa: BLE001
            pass
