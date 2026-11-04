"""Guard rails for the "account switching only, never touch the game" promise.

RiotSwitcher is allowed to swap the *Riot Client* login/session files and to
start/stop client processes. It must never write into the VALORANT (or League)
game installs: that is what anti-cheat treats as tampering.

These tests fail loudly if a future change widens the write surface.
"""

import os
import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent.parent / "src"
_BACKEND = _SRC / "backend"
for path in (str(_SRC), str(_BACKEND)):
    if path not in sys.path:
        sys.path.insert(0, path)

from session_manager import FILES_TO_SWITCH, SessionManager  # noqa: E402

BACKEND_DIR = _BACKEND
RIOT_CLIENT_PREFIX = "Riot Games/Riot Client/"


def _rel(file_def):
    return file_def["rel_path"].replace("\\", "/")


def test_every_swapped_file_lives_under_the_riot_client():
    for file_def in FILES_TO_SWITCH:
        rel = _rel(file_def)
        assert "valorant" not in rel.lower()
        assert "league" not in rel.lower()
        if file_def["base"] == "local_app_data":
            assert rel.startswith(RIOT_CLIENT_PREFIX), rel
        elif file_def["base"] == "install_dir":
            # Only the client's own Config folder, never a sibling game folder.
            assert rel.startswith("Config/"), rel
        else:
            raise AssertionError(f"unexpected base {file_def['base']}")


def test_resolved_paths_stay_inside_the_client_tree(monkeypatch, tmp_path):
    local = tmp_path / "local"
    monkeypatch.setenv("LOCALAPPDATA", str(local))
    install = tmp_path / "Riot Games" / "Riot Client"

    for file_def in FILES_TO_SWITCH:
        resolved = SessionManager._resolve_path(file_def, str(install))
        assert resolved, file_def["id"]
        normalized = os.path.normpath(resolved).replace("\\", "/").lower()
        assert "valorant" not in normalized
        assert "league" not in normalized
        if file_def["base"] == "install_dir":
            assert normalized.startswith(os.path.normpath(str(install)).replace("\\", "/").lower())


def test_backend_sources_never_reference_a_valorant_install_path():
    """No module may build a path into a VALORANT folder.

    Process *names* (``VALORANT.exe``) and API/UI labels are fine; a path
    component is not. The check looks for the game name inside a string that
    also looks like a path, which is exactly the shape a file write needs.
    """
    offenders = []
    sinks = ("open(", "os.path", "shutil.", "pathlib", "makedirs", "os.remove(", "os.rename(")
    for py_file in BACKEND_DIR.rglob("*.py"):
        if "__pycache__" in py_file.parts:
            continue
        text = py_file.read_text(encoding="utf-8", errors="replace")
        for line_no, line in enumerate(text.splitlines(), 1):
            lowered = line.lower()
            if "valorant" not in lowered:
                continue
            # API URLs (/valorant/v3/...) and process names are not file paths.
            if "http" in lowered or ".exe" in lowered:
                continue
            if any(sink in lowered for sink in sinks):
                offenders.append(f"{py_file.relative_to(BACKEND_DIR)}:{line_no}: {line.strip()}")

    assert not offenders, "VALORANT path reference found:\n" + "\n".join(offenders)
