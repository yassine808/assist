"""Tests for the local animated playercard catalogue."""

import os
import sys
import tempfile
import unittest
from unittest import mock

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.join(_ROOT, "src"), os.path.join(_ROOT, "src", "backend")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from backend import animated_cards  # noqa: E402


class TestAnimatedCards(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        for name in ("Astra_Mastery_Card_animated.apng", "Jett_Mastery_Card_animated.apng", "notes.txt"):
            with open(os.path.join(self._tmp.name, name), "w", encoding="utf-8") as handle:
                handle.write("x")

    def tearDown(self):
        self._tmp.cleanup()

    def _with_dir(self):
        return mock.patch.dict(os.environ, {animated_cards.ENV_DIR: self._tmp.name})

    def test_lists_only_apng_files_as_card_urls(self):
        with self._with_dir():
            urls = animated_cards.list_card_urls()
        self.assertEqual(
            urls,
            [
                "card://animated/Astra_Mastery_Card_animated.apng",
                "card://animated/Jett_Mastery_Card_animated.apng",
            ],
        )

    def test_random_picks_from_the_installed_cards(self):
        with self._with_dir():
            url = animated_cards.random_card_url()
            urls = animated_cards.list_card_urls()
        self.assertIn(url, urls)

    def test_missing_folder_yields_nothing(self):
        with mock.patch.dict(os.environ, {animated_cards.ENV_DIR: ""}):
            self.assertEqual(animated_cards.list_card_urls(), [])
            self.assertEqual(animated_cards.random_card_url(), "")

    def test_unreadable_folder_yields_nothing(self):
        with mock.patch.dict(os.environ, {animated_cards.ENV_DIR: os.path.join(self._tmp.name, "nope")}):
            self.assertEqual(animated_cards.list_card_urls(), [])
            self.assertEqual(animated_cards.random_card_url(), "")


if __name__ == "__main__":
    unittest.main()
