"""Riot-related process management.

Mirrors the original Godot RiotProcesses utility. The blocking helpers
(kill_all, wait_until_all_dead) must run off the protocol loop so a long kill
never stalls other requests; call them through the job worker.

Uses taskkill /F /T (force + tree kill) per process for fastest termination.
"""

import subprocess
import time

PROCESS_NAMES = [
    "RiotClientServices.exe",
    "RiotClientUx.exe",
    "RiotClientUxRender.exe",
    "VALORANT.exe",
    "ValorantWin64Shipping.exe",
    "LeagueClient.exe",
    "LeagueClientUx.exe",
    "LeagueClientUxRender.exe",
    "LeagueofLegends.exe",
]

KILL_TIMEOUT_S = 8.0
POLL_INTERVAL_S = 0.2


def is_running(process_name):
    """True while the named process is running. Blocking."""
    try:
        listing = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {process_name}", "/NH"],
            capture_output=True,
            text=True,
            timeout=3,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return process_name.lower() in listing.lower()


def running_processes():
    """Return the names of every known Riot process currently running."""
    return [name for name in PROCESS_NAMES if is_running(name)]


def are_any_running():
    """True while any known process is running. Blocking."""
    return bool(running_processes())


def kill_all(names=None):
    """Force-kill every known (or given) process with taskkill /F /T.

    Spawns one taskkill per process name for fastest parallel termination.
    Each taskkill is non-blocking (Popen) so all kills fire simultaneously.
    """
    names = names or PROCESS_NAMES
    if not names:
        return
    for process_name in names:
        try:
            subprocess.Popen(
                ["taskkill", "/F", "/T", "/IM", process_name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except OSError:
            pass


def kill_names(names):
    """Kill the given process names; convenience alias for kill_all(names)."""
    kill_all(names)


def wait_until_all_dead(timeout_s=KILL_TIMEOUT_S):
    """Poll until every known process is gone or the timeout elapses.

    Returns True if all processes exited in time.
    """
    elapsed = 0.0
    while elapsed < timeout_s:
        if not are_any_running():
            return True
        time.sleep(POLL_INTERVAL_S)
        elapsed += POLL_INTERVAL_S
    return False
