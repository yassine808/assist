"""Regression coverage for "Add Account" capturing the live Riot session.

Before this fix the Add Account flow wrote profile metadata only. No session
files were ever copied into the new profile, so restoring it wiped the live
Riot Client files and the user landed on the login screen instead of being
switched into the account they had just added -- and the next switch saved the
live session into the *previous* profile because LastRunningProfile was stale.

These tests drive the shipped helpers directly.
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_SRC = Path(__file__).resolve().parent.parent / "src"
_BACKEND = _SRC / "backend"
for path in (str(_SRC), str(_BACKEND)):
    if path not in sys.path:
        sys.path.insert(0, path)

# Matches tests/conftest.py: this module only exists inside the packaged app.
sys.modules.setdefault("riot_account_detect", mock.MagicMock())

import launch_orchestrator  # noqa: E402
from account_detector import AccountDetector, unique_profile_name  # noqa: E402
from config_manager import ConfigManager  # noqa: E402
from launch_orchestrator import LaunchOrchestrator  # noqa: E402
from profile_manager import ProfileManager  # noqa: E402
from session_manager import SessionManager  # noqa: E402

import main  # noqa: E402

PRIVATE_SETTINGS = os.path.join(
    "Riot Games", "Riot Client", "Data", "RiotGamesPrivateSettings.yaml"
)


class _TempDirMixin(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = self._tmp.name

    def _sm(self):
        return SessionManager(os.path.join(self.root, "profiles"))

    def _pm(self):
        return ProfileManager(os.path.join(self.root, "profiles.json"))

    def _config(self):
        return ConfigManager(os.path.join(self.root, "configs.json"))


class CaptureSessionTests(_TempDirMixin):
    def _write_live_settings(self, local_app_data):
        path = os.path.join(local_app_data, PRIVATE_SETTINGS)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write('psl:\n  authorization:\n    riot-client:\n      id_token: "x.y.z"\n')
        return path

    def test_captures_live_files_and_marks_profile_running(self):
        local = os.path.join(self.root, "local")
        live = self._write_live_settings(local)
        pm = self._pm()
        pm.create({"profile_name": "NewAccount"})
        config = self._config()

        with mock.patch.dict(os.environ, {"LOCALAPPDATA": local}):
            captured = main._capture_session(
                "NewAccount", self._sm(), pm, config, lambda: ""
            )

        self.assertTrue(captured)
        backup = self._sm().profile_dir("NewAccount")
        self.assertTrue(os.path.isfile(os.path.join(backup, "RiotGamesPrivateSettings.yaml")))
        self.assertEqual("NewAccount", config.get("LastRunningProfile"))
        self.assertTrue(os.path.isfile(live))

    def test_reports_failure_and_keeps_last_profile_when_nothing_to_copy(self):
        local = os.path.join(self.root, "local")
        os.makedirs(local, exist_ok=True)
        pm = self._pm()
        pm.create({"profile_name": "NewAccount"})
        config = self._config()
        config.set("LastRunningProfile", "Previous")

        with mock.patch.dict(os.environ, {"LOCALAPPDATA": local}):
            captured = main._capture_session(
                "NewAccount", self._sm(), pm, config, lambda: ""
            )

        self.assertFalse(captured)
        self.assertEqual("Previous", config.get("LastRunningProfile"))

    def test_install_dir_failure_still_captures_the_account_session(self):
        local = os.path.join(self.root, "local")
        self._write_live_settings(local)
        pm = self._pm()
        pm.create({"profile_name": "NewAccount"})

        def no_client():
            raise RuntimeError("Riot Client location is not set")

        with mock.patch.dict(os.environ, {"LOCALAPPDATA": local}):
            captured = main._capture_session(
                "NewAccount", self._sm(), pm, self._config(), no_client
            )

        self.assertTrue(captured)

    def test_blank_name_is_a_no_op(self):
        self.assertFalse(
            main._capture_session("", self._sm(), self._pm(), self._config(), lambda: "")
        )


class HandlerWiringTests(_TempDirMixin):
    def _handlers(self, capture, capture_current=None):
        return main._build_handlers(
            self._pm(),
            self._config(),
            riot=mock.MagicMock(),
            tracker=mock.MagicMock(),
            detector=mock.MagicMock(),
            orchestrator=mock.MagicMock(),
            sessions=self._sm(),
            league=mock.MagicMock(),
            protocol=mock.MagicMock(),
            data_dir=self.root,
            playercards=mock.MagicMock(),
            running=mock.MagicMock(),
            _league_config_dir=lambda: "",
            _swap_profile=mock.MagicMock(return_value=True),
            _set_playercard=mock.MagicMock(),
            _check_current_account=mock.MagicMock(),
            _capture_current_account=capture_current or mock.MagicMock(),
            _close_all=mock.MagicMock(),
            _profile_dir_name=lambda name: name,
            _cleanup_league_readonly=mock.MagicMock(),
            _capture_session=capture,
        )

    def test_create_profile_handler_captures_the_session(self):
        captured = []
        handlers = self._handlers(captured.append)

        profile = handlers["create_profile"]({"profile_name": "Fresh"})

        self.assertEqual("Fresh", profile["profile_name"])
        self.assertEqual(["Fresh"], captured)

    def test_capture_current_account_is_dispatched(self):
        current = mock.MagicMock(return_value={"added": True, "reason": "created"})
        handlers = self._handlers(mock.MagicMock(), capture_current=current)

        result = handlers["capture_current_account"]({})

        self.assertEqual({"added": True, "reason": "created"}, result)
        current.assert_called_once_with()


class DetectorWiringTests(_TempDirMixin):
    @mock.patch("account_detector.rad")
    def test_finish_notifies_profile_created_callback(self, mock_rad):
        mock_rad.display_uid.return_value = "NewAccount"
        created = []
        detector = AccountDetector(
            profiles=self._pm(),
            on_event=mock.MagicMock(),
            on_profile_created=created.append,
        )

        detector._finish({"puuid": "abc", "riot_region": "eu"})

        self.assertEqual(["NewAccount"], created)
        self.assertIsNotNone(detector.profiles.get("NewAccount"))

    @mock.patch("account_detector.rad")
    def test_auto_save_creates_the_profile_without_waiting_for_a_prompt(self, mock_rad):
        """The Add Account button saves the moment a new login appears."""
        mock_rad.display_uid.return_value = "Fresh#NA1"
        created = []
        detector = AccountDetector(
            profiles=self._pm(),
            on_event=mock.MagicMock(),
            on_profile_created=created.append,
        )
        detector._auto_save = True

        keep_polling = detector._handle_new_account({"puuid": "p"}, "Fresh#NA1")

        self.assertFalse(keep_polling)
        self.assertIsNotNone(detector.profiles.get("Fresh#NA1"))
        self.assertEqual(["Fresh#NA1"], created)


class UniqueNameTests(_TempDirMixin):
    def test_appends_a_suffix_when_the_name_is_taken(self):
        pm = self._pm()
        pm.create({"profile_name": "Same#TAG"})

        name, _counter = unique_profile_name(pm, "Same#TAG")

        self.assertEqual("Same#TAG 2", name)

    def test_falls_back_to_numbered_names_for_empty_display(self):
        name, counter = unique_profile_name(self._pm(), "")

        self.assertEqual("Account 1", name)
        self.assertEqual(2, counter)


class SwitchFlowTests(_TempDirMixin):
    """A saved profile must come back byte-for-byte when switched back to."""

    def _live_settings_path(self, local):
        return os.path.join(local, PRIVATE_SETTINGS)

    def _write_live(self, local, marker):
        path = self._live_settings_path(local)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(f'id_token: "{marker}"\n')
        return path

    def test_switch_restores_the_saved_session_and_launches_the_client(self):
        local = os.path.join(self.root, "local")
        self._write_live(local, "account-one")
        profiles = self._pm()
        profiles.create({"profile_name": "One"})
        config = self._config()
        sessions = self._sm()

        with mock.patch.dict(os.environ, {"LOCALAPPDATA": local}):
            main._capture_session("One", sessions, profiles, config, lambda: "")

            # Another account logs in and gets captured as its own profile.
            self._write_live(local, "account-two")
            profiles.create({"profile_name": "Two"})
            main._capture_session("Two", sessions, profiles, config, lambda: "")
            self.assertEqual("Two", config.get("LastRunningProfile"))

            riot = mock.MagicMock()
            riot.ensure_location.return_value = ""
            riot.launch_client.return_value = 4242
            orchestrator = LaunchOrchestrator(riot, sessions, profiles, config)

            with mock.patch.object(launch_orchestrator.rp, "wait_until_all_dead", return_value=True):
                result = orchestrator.switch_to("One")

            self.assertEqual({"ok": True, "pid": 4242, "profile": "One"}, result)
            with open(self._live_settings_path(local), encoding="utf-8") as fh:
                self.assertEqual('id_token: "account-one"\n', fh.read())
            self.assertEqual("One", config.get("LastRunningProfile"))
            riot.launch_client.assert_called_once()

    def test_switch_aborts_when_restore_fails(self):
        local = os.path.join(self.root, "local")
        self._write_live(local, "account-one")
        profiles = self._pm()
        profiles.create({"profile_name": "One"})
        config = self._config()
        sessions = self._sm()

        riot = mock.MagicMock()
        riot.ensure_location.return_value = ""
        orchestrator = LaunchOrchestrator(riot, sessions, profiles, config)

        with mock.patch.dict(os.environ, {"LOCALAPPDATA": local}), \
                mock.patch.object(launch_orchestrator.rp, "wait_until_all_dead", return_value=True), \
                mock.patch.object(sessions, "restore_session", return_value=False):
            result = orchestrator.switch_to("One")

        self.assertFalse(result["ok"])
        self.assertEqual("restore", result["step"])
        riot.launch_client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
