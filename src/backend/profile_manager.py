"""Profile storage manager.

Persists profiles as a JSON array to a file. This mirrors the model used by
the original Godot app so data remains compatible.

Profile data model:
{
    "profile_name": str,
    "description": str,
    "valorant_puuid": str,
    "valorant_region": str,
    "valorant_in_game_name": str,
    "valorant_data": {
        "tier": int,
        "rank_name": str,
        "rr": int,
        "peak_rank_name": str,
        "wins": int,
        "losses": int,
        "games": int,
        "last_played_ms": int,
        "last_updated_ms": int,
        "act_id": str,
        "top_agent": str,
        "avg_combat_score": int,
    },
    "is_running": bool,
}
"""

import json
import os
import threading


class ProfileManager:
    def __init__(self, path):
        self._path = path
        self._lock = threading.RLock()
        self._profiles = self._read()

    def _read(self):
        if not os.path.exists(self._path):
            return []
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, OSError):
            return []

    def _write(self):
        with self._lock:
            tmp = self._path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._profiles, f, indent=2, ensure_ascii=False)
            os.replace(tmp, self._path)

    def load(self):
        with self._lock:
            return list(self._profiles)

    def get(self, name):
        with self._lock:
            for p in self._profiles:
                if p.get("profile_name") == name:
                    return p
            return None

    def create(self, data):
        name = data.get("profile_name")
        if not name:
            raise ValueError("profile_name is required")
        with self._lock:
            for p in self._profiles:
                if p.get("profile_name") == name:
                    raise ValueError(f"Profile '{name}' already exists")
            profile = {
                "profile_name": name,
                "description": data.get("description", ""),
                "valorant_puuid": data.get("valorant_puuid", ""),
                "valorant_region": data.get("valorant_region", ""),
                "valorant_in_game_name": data.get("valorant_in_game_name", ""),
                "valorant_data": data.get("valorant_data", {}),
                "is_running": False,
            }
            self._profiles.append(profile)
            self._write()
            return profile

    def update(self, name, updates):
        if not name:
            raise ValueError("name is required")
        with self._lock:
            for i, p in enumerate(self._profiles):
                if p.get("profile_name") == name:
                    merged = dict(p)
                    merged.update(updates or {})
                    self._profiles[i] = merged
                    self._write()
                    return merged
            raise ValueError(f"Profile '{name}' not found")

    def delete(self, name):
        if not name:
            raise ValueError("name is required")
        with self._lock:
            before = len(self._profiles)
            self._profiles = [p for p in self._profiles if p.get("profile_name") != name]
            if len(self._profiles) == before:
                raise ValueError(f"Profile '{name}' not found")
            self._write()
            return {"deleted": name}

    def rename(self, old_name, new_name):
        """Rename a profile, preserving the destination value in `valorant_in_game_name`."""
        if not old_name or not new_name:
            raise ValueError("old_name and new_name are required")
        with self._lock:
            for p in self._profiles:
                if p.get("profile_name") == new_name:
                    raise ValueError(f"Profile '{new_name}' already exists")
            for i, p in enumerate(self._profiles):
                if p.get("profile_name") == old_name:
                    previous = p.get("valorant_in_game_name", "")
                    p["profile_name"] = new_name
                    if not previous:
                        p["valorant_in_game_name"] = old_name
                    self._profiles[i] = p
                    self._write()
                    return p
            raise ValueError(f"Profile '{old_name}' not found")

    def update_valorant_data(self, name, data, puuid="", in_game_name="", region=""):
        """Update a profile's VALORANT rank/stats and identity in-place.

        Merges `data` into `valorant_data`, preserving existing fields not
        present in `data` (notably `last_played_ms`). `puuid`/`in_game_name`/
        `region` update the profile identity when non-empty.
        """
        if not name:
            raise ValueError("name is required")
        with self._lock:
            for i, p in enumerate(self._profiles):
                if p.get("profile_name") != name:
                    continue
                current = p.get("valorant_data", {}) or {}
                merged = dict(current)
                merged.update(data or {})
                p["valorant_data"] = merged
                if puuid:
                    p["valorant_puuid"] = puuid
                if region:
                    p["valorant_region"] = region
                if in_game_name:
                    p["valorant_in_game_name"] = in_game_name
                self._profiles[i] = p
                self._write()
                return p
            raise ValueError(f"Profile '{name}' not found")

    def reorder(self, names):
        """Reorder profiles to the order given in `names`.

        Returns the new profile list. Any profiles not in `names` are appended
        at the end in their existing relative order.
        """
        if not isinstance(names, list):
            raise ValueError("names must be a list")
        with self._lock:
            by_name = {p["profile_name"]: p for p in self._profiles}
            ordered = [by_name[n] for n in names if n in by_name]
            for p in self._profiles:
                if p["profile_name"] not in by_name or p["profile_name"] not in names:
                    ordered.append(p)
            self._profiles = ordered
            self._write()
            return list(self._profiles)
