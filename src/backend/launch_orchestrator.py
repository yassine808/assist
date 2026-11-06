"""Orchestrates the full profile-switch flow for launching a profile.

Sequence (mirrors the RiotSwitcher launch flow):
  1. Kill all running Riot processes and wait for them to exit.
  2. Save the currently-active profile's live session files (if any).
  3. Restore the target profile's saved session files.
  4. Optionally sync League settings (if SyncGameSettings is enabled).
  5. Launch the Riot Client with the correct product.

Every step is synchronous so callers know the full switch completed (or exactly
where it failed) before the Riot Client is spawned. Progress is reported
through a listener callback that the backend fans out as IPC events.
"""


import riot_processes as rp
from riot_client import RiotClientError

# Machine-readable reason the UI turns into the "Quit VALORANT?" dialog.
VALORANT_RUNNING = "valorant_running"


class LaunchOrchestrator:
    def __init__(self, riot, sessions, profiles, config, league=None):
        self.riot = riot
        self.sessions = sessions
        self.profiles = profiles
        self.config = config
        self.league = league
        self._listener = None

    def set_listener(self, callback):
        self._listener = callback

    def _emit(self, step, status, message="", **extra):
        if self._listener:
            try:
                self._listener(step, status, message, extra)
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _profile_dir_name(self, name):
        profile = self.profiles.get(name) or {}
        directory_name = profile.get("directory_name", "")
        if not directory_name:
            from session_manager import sanitize_directory_name
            directory_name = sanitize_directory_name(name or "profile")
        return directory_name

    def _install_dir(self):
        return self.riot.ensure_location()

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def _kill_riot_processes(self):
        """Stop the Riot Client before a switch. Never touches VALORANT.

        The game is not ours to close: if VALORANT is running the switch is
        refused and the result carries ``VALORANT_RUNNING`` so the UI can offer
        the "Quit VALORANT?" dialog. Only an explicit confirmation from that
        dialog reaches ``quit_valorant``; otherwise only the Riot Client tree is
        stopped, which is what holds the session files the switch replaces.
        """
        running = [name for name in rp.VALORANT_PROCESSES if rp.is_running(name)]
        if running:
            self._emit("kill", "failed", "Close VALORANT before switching accounts")
            return False, "Close VALORANT before switching accounts", VALORANT_RUNNING

        self._emit("kill", "started", "Stopping Riot Client")
        if not rp.shutdown_stop():
            self._emit("kill", "failed", "Timed out waiting for processes to exit")
            return False, "Timeout waiting for Riot processes to exit", "timeout"
        self._emit("kill", "done", "Riot Client stopped")
        return True, "", ""

    def _save_current_session(self, current_active, profile_name, install_dir):
        """Save the currently-active profile's session if switching away. Returns (ok, error)."""
        if not current_active or current_active == profile_name:
            return True, ""
        # Never overwrite a good backup with a signed-out settings file. The
        # client keeps RiotGamesPrivateSettings.yaml after sign-out, with a
        # null token, which would otherwise destroy the saved login.
        if not self.sessions.live_has_login(install_dir):
            self._emit("save", "warning", "No live Riot login to save")
            return True, ""
        self._emit("save", "started", f"Saving session for {current_active}")
        cur_dir = self._profile_dir_name(current_active)
        saved = self.sessions.save_session(cur_dir, install_dir)
        if saved:
            self._emit("save", "done", "Session saved")
            return True, ""
        self._emit("save", "failed", "Session save incomplete")
        return False, "Session save incomplete"

    def _restore_target_session(self, target_dir, install_dir):
        """Restore the target profile's session files. Returns (ok, error)."""
        self._emit("restore", "started", f"Restoring session for {target_dir}")
        restored = self.sessions.restore_session(target_dir, install_dir)
        if not restored:
            self._emit("restore", "failed", "Session restore failed")
            return False, "Failed to restore session files"
        self._emit("restore", "done", "Session restored")
        return True, ""

    def _sync_league_settings(self):
        """Optionally sync League settings if enabled."""
        if not self.league or not bool(self.config.get("SyncGameSettings", False)):
            return
        self._emit("league", "started", "Syncing League settings")
        try:
            self.league.apply_master_snapshot_to_league(
                self._league_config_dir(),
                bool(self.config.get("EnforceReadOnlySettings", True)),
            )
            self._emit("league", "done", "League settings synced")
        except Exception as exc:  # noqa: BLE001
            self._emit("league", "failed", f"League sync failed: {exc}")

    def _launch_client(self, profile_name):
        """Launch the Riot Client. Returns result dict."""
        self._emit("launch", "started", "Launching Riot Client")
        self.config.set("LastRunningProfile", profile_name)
        pid = self.riot.launch_client()
        self._emit("launch", "done", "Riot Client launched", pid=pid)
        return {"ok": True, "pid": pid, "profile": profile_name}

    def switch_to(self, profile_name):
        """Run the full switch sequence and return a summary dict."""
        self._emit("switch", "started", f"Switching to {profile_name}")

        install_dir = self._install_dir()
        target_dir = self._profile_dir_name(profile_name)
        current_active = str(self.config.get("LastRunningProfile", "") or "")

        # Refuse before touching the running client: a profile with no usable
        # saved token can only restore an empty login screen.
        if not self.sessions.session_has_login(target_dir):
            message = (
                "This profile has no saved Riot login. Delete it and add the "
                "account again while signed in."
            )
            self._emit("restore", "failed", message)
            return {"ok": False, "step": "restore", "error": message, "code": "no_session"}

        try:
            ok, error, code = self._kill_riot_processes()
            if not ok:
                return {"ok": False, "step": "kill", "error": error, "code": code}

            ok, error = self._save_current_session(current_active, profile_name, install_dir)
            if not ok:
                self._emit("switch", "warning", f"Failed to save previous session: {error}")

            ok, error = self._restore_target_session(target_dir, install_dir)
            if not ok:
                return {"ok": False, "step": "restore", "error": error}

            self._sync_league_settings()
            return self._launch_client(profile_name)

        except RiotClientError as exc:
            self._emit("launch", "failed", str(exc))
            return {"ok": False, "step": "launch", "error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            self._emit("switch", "failed", str(exc))
            return {"ok": False, "step": "unknown", "error": str(exc)}

    def stop(self):
        """Stop the Riot Client this app started. VALORANT is left running.

        Only the explicit "stop profile" action reaches this. Closing the
        switcher never stops either process; `kill_all` would also terminate
        VALORANT and ValorantWin64Shipping, which shutdown must never do.
        """
        self._emit("stop", "started", "Stopping Riot Client")
        rp.shutdown_stop()
        self._emit("stop", "done", "Riot Client stopped")
        return {"ok": True}

    def quit_valorant(self):
        """Close the game, after the user confirmed the "Quit VALORANT?" dialog.

        Reached only from that confirmation: a switch and a sign-out refuse
        while the game is running and hand back ``VALORANT_RUNNING`` instead of
        closing anything on their own. Vanguard is left alone.
        """
        self._emit("quit", "started", "Closing VALORANT")
        if not rp.terminate_valorant():
            self._emit("quit", "failed", "VALORANT is still running")
            return {"ok": False, "error": "VALORANT is still running"}
        self._emit("quit", "done", "VALORANT closed")
        return {"ok": True}

    def sign_out(self, profile_name):
        """Exit the Riot Client and drop the live login, keeping the profile.

        The saved profile is untouched: its encrypted session backup stays, so
        switching back to it signs in again. What is removed is the *live*
        login under LOCALAPPDATA, which is why the next client start shows the
        login screen instead of the account that was just signed out.
        """
        ok, error, code = self._kill_riot_processes()
        if not ok:
            return {"ok": False, "step": "kill", "error": error, "code": code}

        try:
            install_dir = self._install_dir()
        except RiotClientError:
            # Only the LOCALAPPDATA login files are cleared, so an unknown
            # install location does not block signing out.
            install_dir = ""

        # Refresh the backup before the live files go away, so switching back
        # to this profile still logs in with the newest tokens.
        current_active = str(self.config.get("LastRunningProfile", "") or "")
        self._save_current_session(current_active, "", install_dir)

        self._emit("signout", "started", f"Signing out of {profile_name or 'the running account'}")
        if not self.sessions.clear_live_session(install_dir):
            self._emit("signout", "failed", "Could not clear the Riot Client session")
            return {"ok": False, "step": "signout", "error": "Could not clear the Riot Client session"}
        self.config.set("LastRunningProfile", "")
        self._emit("signout", "done", "Signed out")
        return {"ok": True}

    def _league_config_dir(self):
        if not self.league:
            return ""
        league_dir = self.league.find_league_dir()
        if not league_dir:
            return ""
        return league_dir + "/Config"
