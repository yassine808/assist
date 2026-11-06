"""Riot-related process management.

Mirrors the original Godot RiotProcesses utility. The blocking helpers
(kill_all, wait_until_all_dead) must run off the protocol loop so a long kill
never stalls other requests; call them through the job worker.

Uses taskkill /F /T (force + tree kill) per process for fastest termination.

VALORANT is never terminated by a switch or by app shutdown. `VALORANT_PROCESSES`
is otherwise used only to detect the game so a switch can be refused while it is
running; the single exception is `terminate_valorant`, which the UI calls only
after the user answers "Quit VALORANT?" in the confirmation dialog. Vanguard is
never targeted by anything in this module.
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


VALORANT_PROCESSES = [
    "VALORANT.exe",
    "ValorantWin64Shipping.exe",
]


RIOT_CLIENT_PROCESSES = [
    "RiotClientServices.exe",
    "RiotClientUx.exe",
    "RiotClientUxRender.exe",
]


def kill_riot_client():
    """Force-kill only Riot Client processes."""
    kill_all(RIOT_CLIENT_PROCESSES)


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


def wait_until_dead(names, timeout_s=KILL_TIMEOUT_S):
    """Poll until the given process names are gone or the timeout elapses."""
    elapsed = 0.0
    while elapsed < timeout_s:
        if not any(is_running(name) for name in names):
            return True
        time.sleep(POLL_INTERVAL_S)
        elapsed += POLL_INTERVAL_S
    return False


def shutdown_stop():
    """Stop the Riot Client only. Used when the app itself is closing.

    The game process is never part of this: VALORANT may be running from the
    launcher before or after RiotSwitcher started, and closing the switcher is
    not a request to close the game. `kill_all` stays reserved for an explicit
    profile switch, which really does need the client tree gone.
    """
    kill_riot_client()
    return wait_until_dead(RIOT_CLIENT_PROCESSES)


def terminate_valorant():
    """Close the game after the user confirmed the "Quit VALORANT?" prompt.

    Nothing calls this on its own: a switch and a sign-out both refuse while
    the game is up, and only the dialog's confirm button reaches it. Vanguard
    is not in `VALORANT_PROCESSES` and is never killed here.
    """
    kill_all(VALORANT_PROCESSES)
    return wait_until_dead(VALORANT_PROCESSES)
