"""Local SQLite catalogue of VALORANT player cards.

The full card list is downloaded from valorant-api.com exactly once, stored in
``playercards.db`` next to the rest of the app data, and read from disk from
then on. The remote catalogue is consulted again only when the stored copy is
older than a week, which is the only way a newly released card can appear.

The store is written to never hold up the UI: a stale cache is refreshed on a
background thread and the current rows are returned immediately. A failed
refresh (offline, API down) leaves the stored rows untouched, because showing
yesterday's cards beats showing none.
"""

import json
import os
import sqlite3
import threading
import time
import urllib.request
from contextlib import closing

CARDS_API_URL = "https://valorant-api.com/v1/playercards"
# New cards ship with a new act, so a weekly look is plenty.
REFRESH_INTERVAL_S = 7 * 24 * 3600
# Do not hammer a failing endpoint on every picker open.
RETRY_INTERVAL_S = 10 * 60
USER_AGENT = "RiotSwitcher/3.0"

_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS playercards (
        uuid         TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        large_art    TEXT NOT NULL,
        first_seen   REAL NOT NULL,
        last_seen    REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """,
)


class PlayercardStore:
    """Thread-safe player-card cache backed by a SQLite file."""

    def __init__(self, data_dir, db_path=None):
        self._db_path = db_path or os.path.join(data_dir, "playercards.db")
        self._write_lock = threading.Lock()
        self._refresh_lock = threading.Lock()
        self._last_failure = 0.0
        self._schema_ready = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_cards(self):
        """Return every cached card as ``{uuid, displayName, largeArt}``.

        An empty cache means first run: the download is awaited, since there is
        nothing to show otherwise. A populated cache is served straight from
        disk and refreshed in the background when it is a week old.
        """
        cards = self._read_all()
        if cards:
            if self._is_stale():
                self.refresh_async()
            return cards

        # First run (or an empty/corrupt cache): the catalogue has to block.
        self.refresh()
        return self._read_all()

    def random_card_url(self):
        """Return one random cached ``largeArt`` URL, or '' when unavailable."""
        row = self._read_random()
        if row:
            if self._is_stale():
                self.refresh_async()
            return row

        self.refresh()
        return self._read_random()

    def count(self):
        return len(self._read_all())

    def last_sync(self):
        """Unix timestamp of the last successful download, or 0."""
        return float(self._read_meta("last_sync") or 0)

    def refresh(self):
        """Download the catalogue and merge it into the cache. Blocking."""
        with self._refresh_lock:
            # Back off after a failed attempt instead of blocking the caller on
            # a dead endpoint every time the picker opens.
            if time.time() - self._last_failure < RETRY_INTERVAL_S:
                return False
            cards = self._download()
            if not cards:
                self._last_failure = time.time()
                return False
            self._upsert(cards)
            return True

    def refresh_async(self):
        """Kick off a background refresh; returns immediately."""
        thread = threading.Thread(target=self._safe_refresh, daemon=True)
        thread.start()
        return thread

    # ------------------------------------------------------------------
    # Cache internals
    # ------------------------------------------------------------------

    def _safe_refresh(self):
        try:
            self.refresh()
        except Exception:  # noqa: BLE001
            pass

    def _is_stale(self):
        last = self.last_sync()
        if not last:
            return True
        return (time.time() - last) >= REFRESH_INTERVAL_S

    def _connect(self):
        directory = os.path.dirname(self._db_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        conn = sqlite3.connect(self._db_path, timeout=10)
        if not self._schema_ready:
            for statement in _SCHEMA:
                conn.execute(statement)
            conn.commit()
            self._schema_ready = True
        return conn

    def _read_all(self):
        try:
            with closing(self._connect()) as conn:
                rows = conn.execute(
                    "SELECT uuid, display_name, large_art FROM playercards ORDER BY display_name"
                ).fetchall()
        except sqlite3.Error:
            return []
        return [
            {"uuid": uuid, "displayName": name, "largeArt": art}
            for uuid, name, art in rows
        ]

    def _read_random(self):
        try:
            with closing(self._connect()) as conn:
                row = conn.execute(
                    "SELECT large_art FROM playercards ORDER BY RANDOM() LIMIT 1"
                ).fetchone()
        except sqlite3.Error:
            return ""
        return row[0] if row else ""

    def _read_meta(self, key):
        try:
            with closing(self._connect()) as conn:
                row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        except sqlite3.Error:
            return None
        return row[0] if row else None

    def _write_meta(self, conn, key, value):
        conn.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )

    def _upsert(self, cards):
        """Merge downloaded cards, keeping rows that have disappeared upstream.

        Cards are never removed from the game, so a card missing from one
        response is far more likely to be an API hiccup than a deletion.
        """
        now = time.time()
        with self._write_lock:
            conn = self._connect()
            try:
                with conn:
                    for card in cards:
                        conn.execute(
                            "INSERT INTO playercards "
                            "(uuid, display_name, large_art, first_seen, last_seen) "
                            "VALUES (?, ?, ?, ?, ?) "
                            "ON CONFLICT(uuid) DO UPDATE SET "
                            "display_name = excluded.display_name, "
                            "large_art = excluded.large_art, "
                            "last_seen = excluded.last_seen",
                            (
                                card["uuid"],
                                card["displayName"],
                                card["largeArt"],
                                now,
                                now,
                            ),
                        )
                    self._write_meta(conn, "last_sync", now)
            finally:
                conn.close()

    def _download(self):
        headers = {"User-Agent": USER_AGENT}
        try:
            req = urllib.request.Request(CARDS_API_URL, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                payload = json.loads(resp.read().decode("utf-8", errors="replace"))
        except Exception:  # noqa: BLE001
            return []

        cards = []
        for entry in payload.get("data", []) or []:
            uuid = str(entry.get("uuid", "") or "")
            name = str(entry.get("displayName", "") or "")
            art = str(entry.get("largeArt", "") or "")
            if uuid and art:
                cards.append({"uuid": uuid, "displayName": name, "largeArt": art})
        return cards
