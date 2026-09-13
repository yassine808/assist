"""Comprehensive tests for the RiotSwitcher Python backend.

Covers: ProfileManager, SessionManager, Protocol, AccountDetector, ConfigManager.

Run with:
    python -m pytest tests/test_backend.py -v
    python -m unittest tests.test_backend -v
"""

import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

# ---------------------------------------------------------------------------
# Import setup — add src/ to path so `from backend.X import Y` works.
# ---------------------------------------------------------------------------
_SRC = os.path.join(os.path.dirname(__file__), os.pardir, "src")
if _SRC not in sys.path:
    sys.path.insert(0, os.path.normpath(_SRC))

from backend.profile_manager import ProfileManager
from backend.session_manager import SessionManager, sanitize_directory_name
from backend.config_manager import ConfigManager
from backend.protocol import Protocol

# Mock riot_account_detect before importing AccountDetector, since the module
# only exists inside the packaged Electron app (not in this test environment).
_rad_mock = mock.MagicMock()
sys.modules.setdefault("riot_account_detect", _rad_mock)
from backend.account_detector import AccountDetector  # noqa: E402


# ===================================================================
# Helper mixin: creates a temp dir per test and cleans up afterwards.
# ===================================================================
class _TempDirMixin:
    def setUp(self):
        self._tmpdir = tempfile.mkdtemp(prefix="riot_test_")

    def tearDown(self):
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def _tmpfile(self, name="data.json"):
        return os.path.join(self._tmpdir, name)


# ===================================================================
# 1. ProfileManager
# ===================================================================
class TestProfileManager(_TempDirMixin, unittest.TestCase):
    # -- helpers -------------------------------------------------------

    def _pm(self, name="profiles.json"):
        return ProfileManager(self._tmpfile(name))

    def _sample(self, name="Alice", **overrides):
        d = {"profile_name": name, "description": "test", **overrides}
        return d

    # -- create --------------------------------------------------------

    def test_create_profile(self):
        pm = self._pm()
        profile = pm.create(self._sample())
        self.assertEqual(profile["profile_name"], "Alice")
        self.assertEqual(pm.get("Alice")["description"], "test")
        self.assertEqual(len(pm.load()), 1)

    def test_create_duplicate(self):
        pm = self._pm()
        pm.create(self._sample("X"))
        with self.assertRaises(ValueError):
            pm.create(self._sample("X"))

    def test_create_missing_name(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.create({"description": "no name"})

    # -- get -----------------------------------------------------------

    def test_get_profile(self):
        pm = self._pm()
        pm.create(self._sample("Bob"))
        self.assertIsNotNone(pm.get("Bob"))
        self.assertIsNone(pm.get("Ghost"))

    # -- update --------------------------------------------------------

    def test_update_profile(self):
        pm = self._pm()
        pm.create(self._sample("Carol"))
        updated = pm.update("Carol", {"description": "updated"})
        self.assertEqual(updated["description"], "updated")
        self.assertEqual(updated["profile_name"], "Carol")
        # Persisted
        self.assertEqual(pm.get("Carol")["description"], "updated")

    def test_update_nonexistent(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.update("Nobody", {"x": 1})

    def test_update_empty_name(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.update("", {"x": 1})

    # -- delete --------------------------------------------------------

    def test_delete_profile(self):
        pm = self._pm()
        pm.create(self._sample("Dan"))
        result = pm.delete("Dan")
        self.assertEqual(result, {"deleted": "Dan"})
        self.assertIsNone(pm.get("Dan"))
        self.assertEqual(len(pm.load()), 0)

    def test_delete_nonexistent(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.delete("Ghost")

    def test_delete_empty_name(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.delete("")

    # -- rename --------------------------------------------------------

    def test_rename_profile(self):
        pm = self._pm()
        pm.create(self._sample("Old"))
        pm.rename("Old", "New")
        self.assertIsNone(pm.get("Old"))
        self.assertIsNotNone(pm.get("New"))
        # valorant_in_game_name should be set to old name when previously empty
        self.assertEqual(pm.get("New")["valorant_in_game_name"], "Old")

    def test_rename_preserves_existing_ign(self):
        pm = self._pm()
        pm.create(self._sample("A", valorant_in_game_name="MyTag"))
        pm.rename("A", "B")
        # Existing valorant_in_game_name should be kept
        self.assertEqual(pm.get("B")["valorant_in_game_name"], "MyTag")

    def test_rename_conflict(self):
        pm = self._pm()
        pm.create(self._sample("X"))
        pm.create(self._sample("Y"))
        with self.assertRaises(ValueError):
            pm.rename("X", "Y")

    def test_rename_not_found(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.rename("Nobody", "New")

    def test_rename_empty_names(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.rename("", "New")
        with self.assertRaises(ValueError):
            pm.rename("Old", "")

    # -- reorder -------------------------------------------------------

    def test_reorder_profiles(self):
        pm = self._pm()
        pm.create(self._sample("A"))
        pm.create(self._sample("B"))
        pm.create(self._sample("C"))
        result = pm.reorder(["C", "A", "B"])
        names = [p["profile_name"] for p in result]
        self.assertEqual(names, ["C", "A", "B"])

    def test_reorder_with_missing_name(self):
        pm = self._pm()
        pm.create(self._sample("A"))
        pm.create(self._sample("B"))
        pm.create(self._sample("C"))
        # "D" doesn't exist — should be ignored; "C" not listed should be appended
        result = pm.reorder(["B", "A", "D"])
        names = [p["profile_name"] for p in result]
        self.assertEqual(names, ["B", "A", "C"])

    def test_reorder_not_list(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.reorder("not a list")

    # -- export / import round-trip ------------------------------------

    def test_export_import_round_trip(self):
        pm = self._pm()
        pm.create(self._sample("E1"))
        pm.create(self._sample("E2"))
        encrypted = pm.export_profiles("s3cret")

        pm2 = self._pm("other.json")
        result = pm2.import_profiles("s3cret", encrypted)
        self.assertEqual(result["imported"], 2)
        self.assertEqual(result["skipped"], 0)
        self.assertEqual(result["total"], 2)
        self.assertIsNotNone(pm2.get("E1"))
        self.assertIsNotNone(pm2.get("E2"))

    def test_import_wrong_passkey(self):
        pm = self._pm()
        pm.create(self._sample("X"))
        encrypted = pm.export_profiles("correct")
        pm2 = self._pm("other.json")
        with self.assertRaises(ValueError):
            pm2.import_profiles("wrong", encrypted)

    def test_import_empty_passkey(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.export_profiles("")

    def test_import_empty_passkey_on_import(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.import_profiles("", b"fake")

    def test_import_merge(self):
        # Source has "Existing" and "Extra" — target already has "Existing"
        pm = self._pm()
        pm.create(self._sample("Existing"))
        pm.create(self._sample("Extra"))
        encrypted = pm.export_profiles("pass")

        pm2 = self._pm("merge.json")
        pm2.create(self._sample("Existing"))
        pm2.create(self._sample("Unique2"))
        result = pm2.import_profiles("pass", encrypted, merge=True)
        # "Existing" is skipped (name already present), "Extra" is imported
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["imported"], 1)
        self.assertIsNotNone(pm2.get("Extra"))
        self.assertIsNotNone(pm2.get("Unique2"))

    def test_import_replace(self):
        pm = self._pm()
        pm.create(self._sample("Old1"))
        pm.create(self._sample("Old2"))
        encrypted = pm.export_profiles("pass")

        pm2 = self._pm("replace.json")
        pm2.create(self._sample("Ghost"))
        result = pm2.import_profiles("pass", encrypted, merge=False)
        self.assertEqual(result["imported"], 2)
        self.assertEqual(len(pm2.load()), 2)
        self.assertIsNone(pm2.get("Ghost"))

    def test_import_validation_bad_data(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.import_profiles("k", b"not-encrypted-data")

    def test_import_validation_not_list(self):
        """Encrypted payload that decodes to a dict, not a list, is rejected."""
        import base64
        import hashlib
        from cryptography.fernet import Fernet

        salt = b"riotswitcher-export-v1"
        dk = hashlib.pbkdf2_hmac("sha256", b"pass", salt, 480_000)
        key = base64.urlsafe_b64encode(dk)
        fernet = Fernet(key)
        bad_payload = fernet.encrypt(json.dumps({"not": "a list"}).encode())

        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.import_profiles("pass", bad_payload)

    # -- update_valorant_data ------------------------------------------

    def test_update_valorant_data(self):
        pm = self._pm()
        pm.create(self._sample("V1"))
        pm.update("V1", {"valorant_data": {"tier": 10, "wins": 5}})
        updated = pm.update_valorant_data(
            "V1",
            {"tier": 20, "rr": 50},
            puuid="puuid-123",
            in_game_name="Player#0001",
            region="na",
        )
        vd = updated["valorant_data"]
        # New fields merged, old field (wins) preserved
        self.assertEqual(vd["tier"], 20)
        self.assertEqual(vd["rr"], 50)
        self.assertEqual(vd["wins"], 5)
        # Identity updated
        self.assertEqual(updated["valorant_puuid"], "puuid-123")
        self.assertEqual(updated["valorant_in_game_name"], "Player#0001")
        self.assertEqual(updated["valorant_region"], "na")

    def test_update_valorant_data_not_found(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.update_valorant_data("Ghost", {"tier": 1})

    def test_update_valorant_data_empty_name(self):
        pm = self._pm()
        with self.assertRaises(ValueError):
            pm.update_valorant_data("", {"tier": 1})

    # -- persistence ---------------------------------------------------

    def test_persistence_on_new_instance(self):
        path = self._tmpfile("persist.json")
        pm1 = ProfileManager(path)
        pm1.create(self._sample("Persist"))
        # New instance reading the same file should see it
        pm2 = ProfileManager(path)
        self.assertIsNotNone(pm2.get("Persist"))

    def test_corrupt_file_returns_empty(self):
        path = self._tmpfile("corrupt.json")
        with open(path, "w") as f:
            f.write("{invalid json")
        pm = ProfileManager(path)
        self.assertEqual(pm.load(), [])

    def test_non_list_file_returns_empty(self):
        path = self._tmpfile("dict.json")
        with open(path, "w") as f:
            json.dump({"not": "a list"}, f)
        pm = ProfileManager(path)
        self.assertEqual(pm.load(), [])


# ===================================================================
# 2. SessionManager
# ===================================================================
class TestSessionManager(_TempDirMixin, unittest.TestCase):

    def _sm(self):
        return SessionManager(os.path.join(self._tmpdir, "profiles"))

    def test_profile_dir(self):
        sm = self._sm()
        expected = os.path.join(self._tmpdir, "profiles", "My_Profile")
        self.assertEqual(sm.profile_dir("My Profile"), expected)

    def test_profile_dir_special_chars(self):
        sm = self._sm()
        result = sm.profile_dir("A/B\\C:D*E")
        basename = os.path.basename(result)
        # Basename should be sanitized — no separators or colons
        self.assertNotIn("/", basename)
        self.assertNotIn("\\", basename)
        self.assertNotIn(":", basename)
        self.assertNotIn("*", basename)

    def test_delete_profile_dir(self):
        sm = self._sm()
        pdir = sm.profile_dir("Test")
        os.makedirs(pdir, exist_ok=True)
        with open(os.path.join(pdir, "file.txt"), "w") as f:
            f.write("data")
        self.assertTrue(os.path.isdir(pdir))
        result = sm.delete_profile_dir("Test")
        self.assertTrue(result)
        self.assertFalse(os.path.isdir(pdir))

    def test_delete_profile_dir_nonexistent(self):
        sm = self._sm()
        # Deleting a non-existent dir should return True (already clean)
        self.assertTrue(sm.delete_profile_dir("Ghost"))

    def test_save_restore_round_trip(self):
        """Create fake Riot files, save them to profile, delete originals, restore."""
        sm = self._sm()
        # Create a fake "install dir" with a config file
        install = os.path.join(self._tmpdir, "install")
        cfg_dir = os.path.join(install, "Config")
        os.makedirs(cfg_dir, exist_ok=True)
        cfg_file = os.path.join(cfg_dir, "client.config.yaml")
        with open(cfg_file, "w") as f:
            f.write("version: 1.0\n")

        # Save session
        result = sm.save_session("TestProfile", install)
        self.assertTrue(result)

        # Verify backup dir was created with the file
        backup = sm.profile_dir("TestProfile")
        self.assertTrue(os.path.isdir(backup))
        backup_file = os.path.join(backup, "client.config.yaml")
        self.assertTrue(os.path.isfile(backup_file))

        # Modify original
        with open(cfg_file, "w") as f:
            f.write("version: 2.0\n")

        # Restore
        result = sm.restore_session("TestProfile", install)
        self.assertTrue(result)

        # Verify restored content
        with open(cfg_file) as f:
            content = f.read()
        self.assertIn("version: 1.0", content)

    def test_save_session_no_install_dir(self):
        """Save session with empty install dir — should succeed (skips missing files)."""
        sm = self._sm()
        result = sm.save_session("TestProfile", "")
        self.assertTrue(result)

    def test_copy_file_atomic(self):
        """Test the low-level atomic file copy directly."""
        sm = self._sm()
        src = os.path.join(self._tmpdir, "src_file.txt")
        dst = os.path.join(self._tmpdir, "dst_file.txt")
        with open(src, "w") as f:
            f.write("atomic content")
        ret = sm._copy_file_atomic(src, dst)
        self.assertEqual(ret, 0)
        self.assertTrue(os.path.isfile(dst))
        with open(dst) as f:
            self.assertEqual(f.read(), "atomic content")
        # Temp file should not linger
        self.assertFalse(os.path.isfile(dst + ".tmp"))

    def test_copy_file_atomic_overwrite(self):
        """Atomic copy should overwrite an existing destination file."""
        sm = self._sm()
        src = os.path.join(self._tmpdir, "src.txt")
        dst = os.path.join(self._tmpdir, "dst.txt")
        with open(src, "w") as f:
            f.write("new")
        with open(dst, "w") as f:
            f.write("old")
        ret = sm._copy_file_atomic(src, dst)
        self.assertEqual(ret, 0)
        with open(dst) as f:
            self.assertEqual(f.read(), "new")

    def test_copy_file_atomic_missing_source(self):
        sm = self._sm()
        ret = sm._copy_file_atomic(
            os.path.join(self._tmpdir, "nope.txt"),
            os.path.join(self._tmpdir, "dst.txt"),
        )
        self.assertNotEqual(ret, 0)

    def test_copy_dir_atomic(self):
        """Atomic directory copy round-trips correctly."""
        sm = self._sm()
        src = os.path.join(self._tmpdir, "dir_src")
        dst = os.path.join(self._tmpdir, "dir_dst")
        os.makedirs(os.path.join(src, "sub"))
        with open(os.path.join(src, "a.txt"), "w") as f:
            f.write("hello")
        with open(os.path.join(src, "sub", "b.txt"), "w") as f:
            f.write("world")
        ret = sm._copy_dir_atomic(src, dst)
        self.assertEqual(ret, 0)
        self.assertTrue(os.path.isfile(os.path.join(dst, "a.txt")))
        self.assertTrue(os.path.isfile(os.path.join(dst, "sub", "b.txt")))
        # Temp dir should not linger
        self.assertFalse(os.path.isdir(dst + "_tmp"))

    def test_save_restore_dir_session(self):
        """Save and restore a directory-type file (Sessions)."""
        sm = self._sm()
        install = os.path.join(self._tmpdir, "install")
        # Create a fake "Sessions" directory under install
        sessions_dir = os.path.join(install, "Config")
        os.makedirs(sessions_dir, exist_ok=True)
        # We need to mock the resolve to point at a local dir
        # Instead, directly test _backup_one_file with a dir source
        source_dir = os.path.join(self._tmpdir, "source_sessions")
        os.makedirs(os.path.join(source_dir, "sess1"), exist_ok=True)
        with open(os.path.join(source_dir, "sess1", "data.json"), "w") as f:
            f.write("{}")

        profile_dir = sm.profile_dir("TestDir")
        os.makedirs(profile_dir, exist_ok=True)

        file_def = {
            "id": "sessions_dir",
            "filename": "Sessions",
            "base": "local_app_data",
            "rel_path": "Sessions",
            "is_dir": True,
        }
        # Monkey-patch _resolve_path to return our test source
        with mock.patch.object(SessionManager, "_resolve_path", return_value=source_dir):
            ret = sm._backup_one_file(file_def, profile_dir, install)
        self.assertTrue(ret)
        self.assertTrue(os.path.isdir(os.path.join(profile_dir, "Sessions")))


# ===================================================================
# 3. Protocol (with mocked stdin/stdout)
# ===================================================================
class TestProtocol(unittest.TestCase):

    def _proto(self, stdin_text=""):
        """Create a Protocol with a mock stdin and capture stdout."""
        p = Protocol()
        stdin = io.StringIO(stdin_text)
        stdout = io.StringIO()
        # Patch sys.stdin and sys.stdout at module level
        p._stdin_patcher = mock.patch("backend.protocol.sys.stdin", stdin)
        p._stdout_patcher = mock.patch("backend.protocol.sys.stdout", stdout)
        p._stdin_patcher.start()
        p._stdout_patcher.start()
        p._stdout = stdout
        return p

    def tearDown(self):
        # Clean up any patches created by _proto
        for attr in ("_stdin_patcher", "_stdout_patcher"):
            if hasattr(self, "_proto_instance"):
                getattr(self._proto_instance, attr, None) and getattr(
                    self._proto_instance, attr
                ).stop()

    def test_read_request_valid(self):
        p = self._proto('{"id":1,"method":"ping","params":{}}\n')
        self._proto_instance = p
        result = p.read_request()
        self.assertEqual(result["id"], 1)
        self.assertEqual(result["method"], "ping")

    def test_read_request_empty_line(self):
        p = self._proto('\n\n{"id":2,"method":"pong"}\n')
        self._proto_instance = p
        result = p.read_request()
        self.assertEqual(result["id"], 2)

    def test_read_request_invalid_json(self):
        p = self._proto('not json\n{"id":3}\n')
        self._proto_instance = p
        result = p.read_request()
        self.assertEqual(result["id"], 3)

    def test_read_request_eof(self):
        p = self._proto("")
        self._proto_instance = p
        result = p.read_request()
        self.assertIsNone(result)

    def test_send_response(self):
        p = self._proto("")
        self._proto_instance = p
        p.send_response(42, result={"ok": True})
        output = p._stdout.getvalue().strip()
        data = json.loads(output)
        self.assertEqual(data["id"], 42)
        self.assertTrue(data["result"]["ok"])
        self.assertNotIn("error", data)

    def test_send_response_error(self):
        p = self._proto("")
        self._proto_instance = p
        p.send_response(99, error="something broke")
        data = json.loads(p._stdout.getvalue().strip())
        self.assertEqual(data["id"], 99)
        self.assertEqual(data["error"], "something broke")
        self.assertNotIn("result", data)

    def test_send_event(self):
        p = self._proto("")
        self._proto_instance = p
        p.send_event("profile_created", {"name": "Test"})
        data = json.loads(p._stdout.getvalue().strip())
        self.assertEqual(data["event"], "profile_created")
        self.assertEqual(data["params"]["name"], "Test")

    def test_thread_safety(self):
        """Concurrent writes produce valid JSON lines without corruption."""
        p = self._proto("")
        self._proto_instance = p
        errors = []

        def writer(i):
            try:
                for j in range(50):
                    p.send_response(i * 1000 + j, result={"i": i, "j": j})
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(t,)) for t in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        lines = [l for l in p._stdout.getvalue().strip().split("\n") if l]
        self.assertEqual(len(lines), 200)
        for line in lines:
            data = json.loads(line)
            self.assertIn("id", data)
            self.assertIn("result", data)


# ===================================================================
# 4. AccountDetector
# ===================================================================
class TestAccountDetector(_TempDirMixin, unittest.TestCase):

    def _make_detector(self, existing_names=None, on_event=None, on_profile_created=None):
        """Create an AccountDetector with a mock ProfileManager."""
        existing_names = existing_names or []
        pm = ProfileManager(self._tmpfile("profiles.json"))
        for n in existing_names:
            pm.create({"profile_name": n})
        return AccountDetector(
            profiles=pm,
            on_event=on_event,
            on_profile_created=on_profile_created,
        )

    @mock.patch("backend.account_detector.rad")
    def test_next_profile_name_empty_uid(self, mock_rad):
        """When display_uid returns empty, falls back to 'Account N'."""
        mock_rad.display_uid.return_value = ""
        det = self._make_detector()
        name = det._next_profile_name({})
        self.assertTrue(name.startswith("Account "))
        self.assertEqual(name, "Account 1")

    @mock.patch("backend.account_detector.rad")
    def test_next_profile_name_unique(self, mock_rad):
        """When base name is not taken, return it directly."""
        mock_rad.display_uid.return_value = "UniqueName"
        det = self._make_detector()
        name = det._next_profile_name({})
        self.assertEqual(name, "UniqueName")

    @mock.patch("backend.account_detector.rad")
    def test_next_profile_name_collision(self, mock_rad):
        """When base name is taken, appends ' 2', ' 3', etc."""
        mock_rad.display_uid.return_value = "Taken"
        det = self._make_detector(existing_names=["Taken"])
        name = det._next_profile_name({})
        self.assertEqual(name, "Taken 2")

    @mock.patch("backend.account_detector.rad")
    def test_next_profile_name_multiple_collisions(self, mock_rad):
        """When base and base+2 are taken, returns base+3."""
        mock_rad.display_uid.return_value = "Taken"
        det = self._make_detector(existing_names=["Taken", "Taken 2"])
        name = det._next_profile_name({})
        self.assertEqual(name, "Taken 3")

    @mock.patch("backend.account_detector.rad")
    def test_next_profile_name_safety_cap(self, mock_rad):
        """When every slot is taken up to MAX, raises RuntimeError."""
        mock_rad.display_uid.return_value = "Full"
        det = self._make_detector()
        # The collision loop starts at index=2 and runs MAX_ATTEMPTS (10000)
        # iterations, checking "Full 2" through "Full 10001". We must fill all
        # those slots so every candidate is taken and the RuntimeError fires.
        names = ["Full"] + [f"Full {i}" for i in range(2, 10002)]
        det.profiles._profiles = [{"profile_name": n} for n in names]
        with self.assertRaises(RuntimeError):
            det._next_profile_name({})

    @mock.patch("backend.account_detector.rad")
    def test_next_profile_name_empty_uid_safety_cap(self, mock_rad):
        """When display_uid is empty and all Account N slots are taken."""
        mock_rad.display_uid.return_value = ""
        det = self._make_detector()
        det.profiles._profiles = [{"profile_name": f"Account {i}"} for i in range(10001)]
        with self.assertRaises(RuntimeError):
            det._next_profile_name({})

    def test_is_running_initially_false(self):
        det = self._make_detector()
        self.assertFalse(det.is_running())

    def test_stop_detection_when_not_running(self):
        """Calling stop_detection when nothing is running should not raise."""
        det = self._make_detector()
        det.stop_detection()  # No-op, should not raise

    @mock.patch("backend.account_detector.rad")
    def test_stop_detection_stops_thread(self, mock_rad):
        """start_detection spawns a thread, stop_detection joins it."""
        mock_rad.read_live_account.return_value = None
        det = self._make_detector()
        # The _run method needs launcher/killer to be mockable
        det.launcher = mock.Mock()
        det.killer = mock.Mock()

        # Patch _run to just sleep so we can control the stop
        def fake_run():
            while not det._stop.is_set():
                det._stop.wait(0.05)

        det._run = fake_run
        started = det.start_detection()
        self.assertTrue(started)
        time.sleep(0.1)
        self.assertTrue(det.is_running())
        det.stop_detection()
        self.assertFalse(det.is_running())

    @mock.patch("backend.account_detector.rad")
    def test_start_detection_returns_false_if_already_running(self, mock_rad):
        det = self._make_detector()
        det.launcher = mock.Mock()
        det.killer = mock.Mock()

        def fake_run():
            while not det._stop.is_set():
                det._stop.wait(0.05)

        det._run = fake_run
        self.assertTrue(det.start_detection())
        time.sleep(0.05)
        self.assertFalse(det.start_detection())
        det.stop_detection()


# ===================================================================
# 5. ConfigManager
# ===================================================================
class TestConfigManager(_TempDirMixin, unittest.TestCase):

    def _cfg(self, name="config.json"):
        return ConfigManager(self._tmpfile(name))

    def test_set_get(self):
        cfg = self._cfg()
        cfg.set("RiotClientLocation", "C:\\Riot")
        self.assertEqual(cfg.get("RiotClientLocation"), "C:\\Riot")

    def test_get_missing_returns_default(self):
        cfg = self._cfg()
        self.assertIsNone(cfg.get("Nonexistent"))
        self.assertEqual(cfg.get("Nonexistent", "fallback"), "fallback")

    def test_all(self):
        cfg = self._cfg()
        cfg.set("A", 1)
        cfg.set("B", 2)
        all_cfg = cfg.all()
        self.assertIsInstance(all_cfg, dict)
        self.assertEqual(all_cfg["A"], 1)
        self.assertEqual(all_cfg["B"], 2)
        # Should be a copy, not a reference
        all_cfg["C"] = 3
        self.assertIsNone(cfg.get("C"))

    def test_set_many(self):
        cfg = self._cfg()
        result = cfg.set_many({"X": 10, "Y": 20, "Z": 30})
        self.assertTrue(result)
        self.assertEqual(cfg.get("X"), 10)
        self.assertEqual(cfg.get("Y"), 20)
        self.assertEqual(cfg.get("Z"), 30)

    def test_defaults(self):
        """Known default keys are present even on a fresh config."""
        cfg = self._cfg()
        self.assertEqual(cfg.get("LaunchProduct"), "valorant")
        self.assertEqual(cfg.get("Language"), "en")
        self.assertFalse(cfg.get("SyncGameSettings"))
        self.assertTrue(cfg.get("EnforceReadOnlySettings"))

    def test_persistence(self):
        path = self._tmpfile("persist_cfg.json")
        cfg1 = ConfigManager(path)
        cfg1.set("CustomKey", "custom_value")
        cfg2 = ConfigManager(path)
        self.assertEqual(cfg2.get("CustomKey"), "custom_value")

    def test_corrupt_file_keeps_defaults(self):
        path = self._tmpfile("bad.json")
        with open(path, "w") as f:
            f.write("not valid json {{{")
        cfg = ConfigManager(path)
        # Should still have defaults
        self.assertEqual(cfg.get("LaunchProduct"), "valorant")

    def test_save_returns_true(self):
        cfg = self._cfg()
        self.assertTrue(cfg.save())

    def test_set_many_persists_once(self):
        """set_many updates all keys then saves once."""
        cfg = self._cfg()
        cfg.set_many({"A": 1, "B": 2})
        # Re-read from disk
        cfg2 = ConfigManager(cfg._path)
        self.assertEqual(cfg2.get("A"), 1)
        self.assertEqual(cfg2.get("B"), 2)

    def test_overwrite_existing(self):
        cfg = self._cfg()
        cfg.set("Key", "old")
        cfg.set("Key", "new")
        self.assertEqual(cfg.get("Key"), "new")

    def test_thread_safety_concurrent_sets(self):
        """Concurrent set_many calls don't corrupt the file."""
        cfg = self._cfg()
        errors = []

        def writer(prefix):
            try:
                for i in range(50):
                    cfg.set(f"{prefix}_{i}", i)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(f"t{t}",)) for t in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        # File should still be valid JSON
        with open(cfg._path) as f:
            data = json.load(f)
        self.assertIsInstance(data, dict)


# ===================================================================
# 6. sanitize_directory_name (session_manager helper)
# ===================================================================
class TestSanitizeDirectoryName(unittest.TestCase):

    def test_normal_name(self):
        self.assertEqual(sanitize_directory_name("MyProfile"), "MyProfile")

    def test_spaces_to_underscores(self):
        self.assertEqual(sanitize_directory_name("My Profile"), "My_Profile")

    def test_special_chars(self):
        result = sanitize_directory_name("A/B\\C:D*E?F")
        self.assertNotIn("/", result)
        self.assertNotIn("\\", result)
        self.assertNotIn(":", result)
        self.assertNotIn("*", result)
        self.assertNotIn("?", result)

    def test_empty_string(self):
        self.assertEqual(sanitize_directory_name(""), "profile")

    def test_none(self):
        self.assertEqual(sanitize_directory_name(None), "profile")

    def test_collapses_whitespace(self):
        result = sanitize_directory_name("  too   many   spaces  ")
        self.assertNotIn("  ", result)

    def test_keeps_hyphens(self):
        self.assertEqual(sanitize_directory_name("a-b"), "a-b")


if __name__ == "__main__":
    unittest.main()
