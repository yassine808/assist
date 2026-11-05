"""Compatibility and data-location tests for the backend entry point.

The packaged app must keep one data folder no matter where the exe was
launched from, and upgrading from the old %APPDATA% layout must move the
session tokens rather than leave a second copy behind.
"""

import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "backend"))

import main  # noqa: E402


class TestDataDir(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.program_data = os.path.join(self.root, "ProgramData")
        self.app_data = os.path.join(self.root, "AppData", "Roaming")
        os.makedirs(self.program_data)
        os.makedirs(self.app_data)

    def tearDown(self):
        self._tmp.cleanup()

    def _env(self):
        return {
            "PROGRAMDATA": self.program_data,
            "APPDATA": self.app_data,
        }

    def test_packaged_data_lives_under_program_data(self):
        with mock.patch.dict(os.environ, self._env(), clear=False), \
                mock.patch.object(sys, "argv", ["main.py"]):
            os.environ.pop("RIOTSWITCHER_DEV", None)
            os.environ.pop("RIOTSWITCHER_DATA_DIR", None)
            self.assertEqual(
                main._determine_data_dir(),
                os.path.join(self.program_data, "RiotSwitcher"),
            )

    def test_explicit_override_wins(self):
        target = os.path.join(self.root, "custom")
        env = {**self._env(), "RIOTSWITCHER_DATA_DIR": target}
        with mock.patch.dict(os.environ, env, clear=False), \
                mock.patch.object(sys, "argv", ["main.py"]):
            self.assertEqual(main._determine_data_dir(), target)

    def test_legacy_data_is_moved_not_copied(self):
        target = os.path.join(self.program_data, "RiotSwitcher")
        legacy = os.path.join(self.app_data, "RiotSwitcher")
        os.makedirs(os.path.join(legacy, "profiles", "Account_1"))
        profiles_file = os.path.join(legacy, "profiles_data.json")
        with open(profiles_file, "w", encoding="utf-8") as handle:
            handle.write("[]")
        with open(
            os.path.join(legacy, "profiles", "Account_1", "Sessions"),
            "wb",
        ) as handle:
            handle.write(b"RSENC1\nsealed-token")

        with mock.patch.dict(os.environ, self._env(), clear=False):
            self.assertEqual(main._migrate_legacy_data(target), 2)

        # Everything arrived, and the old copies are gone: no second token copy.
        self.assertTrue(os.path.isfile(os.path.join(target, "profiles_data.json")))
        self.assertTrue(
            os.path.isfile(os.path.join(target, "profiles", "Account_1", "Sessions"))
        )
        self.assertFalse(os.path.exists(profiles_file))
        self.assertFalse(os.path.exists(os.path.join(legacy, "profiles")))

    def test_existing_target_is_not_overwritten(self):
        target = os.path.join(self.program_data, "RiotSwitcher")
        legacy = os.path.join(self.app_data, "RiotSwitcher")
        os.makedirs(target)
        os.makedirs(legacy)
        with open(os.path.join(target, "profiles_data.json"), "w") as handle:
            handle.write("new")
        with open(os.path.join(legacy, "profiles_data.json"), "w") as handle:
            handle.write("old")

        with mock.patch.dict(os.environ, self._env(), clear=False):
            self.assertEqual(main._migrate_legacy_data(target), 0)

        with open(os.path.join(target, "profiles_data.json")) as handle:
            self.assertEqual(handle.read(), "new")
        # The old item is left where it was instead of being deleted blind.
        self.assertTrue(os.path.isfile(os.path.join(legacy, "profiles_data.json")))


if __name__ == "__main__":
    unittest.main()
