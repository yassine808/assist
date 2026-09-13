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
RELAUNCH_WAIT_S = 8  # wait for Riot Client to fully restart after kill
DETECTION_TIMEOUT_S = 300  # give up after 5 minutes of no new login


class AccountDetector:
    def __init__(self, profiles, on_event=None, launcher=None, on_profile_created=None, killer=None):
        self.profiles = profiles
        self.on_event = on_event
        self.launcher = launcher
        self.killer = killer  # called before launcher() to ensure fresh client
        self._on_profile_created = on_profile_created
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._display_name_counter = 1
        self._pending_account = None
        self._confirm_event = threading.Event()

    def _emit(self, name, data):
        if self.on_event:
            try:
                self.on_event(name, data)
            except Exception:  # noqa: BLE001
                pass

    def _next_profile_name(self, account):
        MAX_ATTEMPTS = 10000
        base = rad.display_uid(account)
        if not base:
            for _ in range(MAX_ATTEMPTS):
                candidate = f"Account {self._display_name_counter}"
                self._display_name_counter += 1
                if not self.profiles.get(candidate):
                    return candidate
            raise RuntimeError("Could not generate unique profile name")
        if not self.profiles.get(base):
            return base
        index = 2
        for _ in range(MAX_ATTEMPTS):
            if not self.profiles.get(f"{base} {index}"):
                return f"{base} {index}"
            index += 1
        raise RuntimeError("Could not generate unique profile name")

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
        self._confirm_event.set()  # unblock any waiting confirmation
        with self._lock:
            thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=2.0)

    def confirm_save(self, accepted):
        """User responded to the save-account confirmation prompt.

        accepted=True  -> create the profile from the pending account.
        accepted=False -> discard and continue detection (or stop).
        """
        self._pending_decision = accepted
        self._confirm_event.set()

    def _try_kill(self):
        """Kill existing Riot processes, ignoring errors."""
        if not self.killer:
            return
        try:
            self.killer()
        except Exception:  # noqa: BLE001
            pass

    def _try_launch(self):
        """Launch the Riot Client. Returns False on failure."""
        if not self.launcher:
            return True
        try:
            self.launcher()
        except Exception as exc:  # noqa: BLE001
            self._emit("account_detection_progress", {"status": "error", "message": f"Failed to launch Riot Client: {exc}"})
            return False
        return True

    def _clear_riot_saved_credentials(self):
        """Delete Riot Client saved credentials to force a fresh login screen."""
        import os
        settings_path = os.path.join(
            os.environ.get("LOCALAPPDATA", ""),
            "Riot Games", "Riot Client", "Data", "RiotGamesPrivateSettings.yaml",
        )
        if os.path.isfile(settings_path):
            try:
                os.remove(settings_path)
            except OSError:
                pass

    def _handle_already_added(self, display):
        """Re-launch client with cleared credentials when a known account is detected."""
        self._emit("account_detection_progress", {
            "status": "already_added",
            "message": f"{display} is already added. Opening login\u2026",
            "display": display,
        })
        self._try_kill()
        self._clear_riot_saved_credentials()
        self._try_launch()

    def _handle_new_account(self, account, display):
        """Prompt user and handle save/decline for a newly detected account."""
        self._pending_account = account
        self._pending_decision = None
        self._confirm_event.clear()

        self._emit("account_detection_progress", {
            "status": "confirm_save",
            "message": f"New account detected: {display}",
            "display": display,
        })

        self._confirm_event.wait()

        if self._stop.is_set():
            return False
        if self._pending_decision:
            self._finish(account)
            return False
        # User declined
        self._emit("account_detection_progress", {
            "status": "waiting",
            "message": "Waiting for login\u2026",
        })
        return True  # continue polling

    def _run(self):
        self._emit("account_detection_progress", {"status": "waiting", "message": "Opening Riot Client\u2026"})
        self._try_kill()
        if not self._try_launch():
            return

        self._emit("account_detection_progress", {"status": "waiting", "message": "Waiting for login\u2026"})

        started = time.time()
        while not self._stop.is_set():
            if time.time() - started > DETECTION_TIMEOUT_S:
                self._emit("account_detection_progress", {"status": "canceled", "message": "Login timed out"})
                return

            account = rad.read_live_account()
            if account:
                profiles_list = self.profiles.load()
                if not rad.is_account_new(account, profiles_list):
                    self._handle_already_added(rad.display_uid(account))
                    started = time.time()
                    self._stop.wait(RELAUNCH_WAIT_S)
                    continue
                if not self._handle_new_account(account, rad.display_uid(account)):
                    return
                started = time.time()

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
