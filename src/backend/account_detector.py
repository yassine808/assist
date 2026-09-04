"""Background detector that watches for a newly logged-in Riot account.

Used by the "Add Account" flow. Launches the Riot Client, then polls the live
Riot Client settings file (decoded via riot_account_detect.read_live_account)
until a brand-new account appears. When detected, a profile is created
automatically and a profile_created event is emitted.

The detector owns its own polling thread; start_detection() returns immediately
and stop_detection() joins the thread.
"""

import threading
import time

import riot_account_detect as rad

POLL_INTERVAL_S = 1.5
DETECTION_TIMEOUT_S = 300  # give up after 5 minutes of no new login


class AccountDetector:
    def __init__(self, profiles, on_event=None, launcher=None, on_profile_created=None):
        self.profiles = profiles
        self.on_event = on_event
        self.launcher = launcher
        self._on_profile_created = on_profile_created
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._display_name_counter = 1

    def _emit(self, name, data):
        if self.on_event:
            try:
                self.on_event(name, data)
            except Exception:  # noqa: BLE001
                pass

    def _next_profile_name(self, account):
        base = rad.display_uid(account)
        if not base:
            while True:
                candidate = f"Account {self._display_name_counter}"
                self._display_name_counter += 1
                if not self.profiles.get(candidate):
                    return candidate
        if not self.profiles.get(base):
            return base
        index = 2
        while self.profiles.get(f"{base} {index}"):
            index += 1
        return f"{base} {index}"

    def is_running(self):
        with self._lock:
            return self._thread is not None and self._thread.is_alive()

    def start_detection(self):
        """Launch the Riot Client (if a launcher is provided) and begin polling."""
        with self._lock:
            if self._thread and self._thread.is_alive():
                return False
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()
        return True

    def stop_detection(self):
        """Signal the polling loop to stop and wait for it to exit."""
        self._stop.set()
        with self._lock:
            thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=2.0)

    def _run(self):
        self._emit("account_detection_progress", {"status": "waiting", "message": "Opening Riot Client…"})
        if self.launcher:
            try:
                self.launcher()
            except Exception as exc:  # noqa: BLE001
                self._emit("account_detection_progress", {"status": "error", "message": f"Failed to launch Riot Client: {exc}"})
                return

        self._emit("account_detection_progress", {"status": "waiting", "message": "Waiting for login…"})

        started = time.time()
        while not self._stop.is_set():
            elapsed = time.time() - started
            if elapsed > DETECTION_TIMEOUT_S:
                self._emit("account_detection_progress", {"status": "canceled", "message": "Login timed out"})
                return

            account = rad.read_live_account()
            if account and rad.is_account_new(account, self.profiles.load()):
                self._finish(account)
                return

            self._stop.wait(POLL_INTERVAL_S)

    def _finish(self, account):
        display = rad.display_uid(account)
        self._emit("account_detection_progress", {
            "status": "detected",
            "message": f"Detected: {display}",
            "display": display,
        })

        name = self._next_profile_name(account)
        try:
            profile = self.profiles.create({
                "profile_name": name,
                "valorant_puuid": account.get("puuid", ""),
                "valorant_region": account.get("riot_region", ""),
                "valorant_in_game_name": display,
            })
        except Exception as exc:  # noqa: BLE001
            self._emit("account_detection_progress", {"status": "error", "message": f"Failed to create profile: {exc}"})
            return

        self._emit("account_detection_progress", {
            "status": "created",
            "message": "Profile created!",
            "profile_name": name,
        })
        self._emit("profile_created", profile)

        # Trigger valorant data refresh so the card shows rank/stats immediately.
        if self._on_profile_created:
            try:
                self._on_profile_created(name)
            except Exception:  # noqa: BLE001
                pass
