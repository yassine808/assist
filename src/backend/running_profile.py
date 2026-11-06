"""Tracks which saved profile is signed in to the live Riot Client.

The Riot Client owns a single session file. Swapping profiles rewrites that
file, so the account identity in it (``read_live_account``) is the source of
truth for "which profile is running". Process state tells us whether a client
is up at all; when it is not, no profile is running.

A short grace period before clearing is deliberate: right after a launch the
client has started but has not written the session file yet. Clearing the
state on that first empty read would make the card flicker from "running" back
to idle. Signing out produces the same empty read, so the state clears after a
few consecutive misses instead.
"""

import threading

DEFAULT_INTERVAL_S = 2.0
DEFAULT_MISS_GRACE = 3


class RunningProfileWatcher:
    def __init__(
        self,
        profiles,
        config,
        process_running,
        live_account,
        on_change=None,
        interval=DEFAULT_INTERVAL_S,
        miss_grace=DEFAULT_MISS_GRACE,
    ):
        self._profiles = profiles
        self._config = config
        self._process_running = process_running
        self._live_account = live_account
        self._on_change = on_change
        self._interval = interval
        self._miss_grace = miss_grace
        self._lock = threading.Lock()
        self._name = ""
        self._misses = 0
        self._stop = threading.Event()
        self._thread = None

    def current(self):
        """Name of the profile that is live right now, or ""."""
        with self._lock:
            return self._name

    def refresh(self):
        """Re-read process + session state and return the running profile.

        Only the first detection of a profile is immediate; clearing an
        existing one waits for ``miss_grace`` consecutive empty reads.
        """
        name = self._detect()
        with self._lock:
            if name:
                self._misses = 0
            elif self._name:
                self._misses += 1
                if self._misses < self._miss_grace:
                    return self._name
            changed = name != self._name
            self._name = name
            self._misses = 0 if name else self._misses
        if changed:
            self._publish(name)
        return name

    def clear(self):
        """Drop the running profile immediately (used after an explicit sign-out).

        ``refresh`` clears on its own only after ``miss_grace`` empty reads, so
        the UI would keep showing the card as running for a few seconds after
        the user signed out. This publishes the transition at once.
        """
        with self._lock:
            changed = bool(self._name)
            self._name = ""
            self._misses = 0
        if changed:
            self._publish("")

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        while not self._stop.wait(self._interval):
            try:
                self.refresh()
            except Exception:  # noqa: BLE001 - a watcher must never kill the app
                pass

    def _publish(self, name):
        # Keep LastRunningProfile useful for the launch flow. Persist only on a
        # real transition so a steady session does not rewrite the config file.
        try:
            if str(self._config.get("LastRunningProfile", "") or "") != name:
                self._config.set("LastRunningProfile", name)
        except Exception:  # noqa: BLE001
            pass
        if self._on_change:
            try:
                self._on_change(name)
            except Exception:  # noqa: BLE001
                pass

    def _detect(self):
        try:
            if not self._process_running():
                return ""
        except Exception:  # noqa: BLE001
            return ""
        try:
            account = self._live_account() or {}
        except Exception:  # noqa: BLE001
            account = {}
        puuid = str(account.get("puuid", "")) if isinstance(account, dict) else ""
        if not puuid:
            return ""
        try:
            profiles = self._profiles.load()
        except Exception:  # noqa: BLE001
            return ""
        for profile in profiles:
            if not isinstance(profile, dict):
                continue
            if str(profile.get("valorant_puuid", "")) == puuid:
                return str(profile.get("profile_name", ""))
        return ""
