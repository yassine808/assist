"""Riot-related process management.

Mirrors the original Godot RiotProcesses utility. The blocking helpers
(kill_all, wait_until_all_dead) must run off the protocol loop so a long kill
never stalls other requests; call them through the job worker.

Uses taskkill /F /T (force + tree kill) per process for fastest termination.
Process *detection* reads one Toolhelp32 snapshot (see `_toolhelp_names`), not
one `tasklist` spawn per process name.

VALORANT is never terminated by a switch or by app shutdown. `VALORANT_PROCESSES`
is otherwise used only to detect the game so a switch can be refused while it is
running; the single exception is `terminate_valorant`, which the UI calls only
after the user answers "Quit VALORANT?" in the confirmation dialog. Vanguard is
never targeted by anything in this module.
"""

import ctypes
import subprocess
import sys
import time

_WINDOWS = sys.platform.startswith("win")

# Toolhelp32 snapshot constants. Reading the process table with this API is a
# single kernel call (~1 ms), where the old per-name `tasklist` spawns cost ~1.3
# seconds for the nine known names -- and the running-profile watcher asks every
# two seconds, so the subprocess version kept a core busy and churned the disk.
_TH32CS_SNAPPROCESS = 0x00000002
_INVALID_HANDLE = ctypes.c_void_p(-1).value
_MAX_PATH = 260

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


_UNSET = object()
_process_api_cache = _UNSET


def _process_api():
    """Return (kernel32, PROCESSENTRY32W, entry size), or None when unavailable.

    Built once and cached: resolving the DLL and setting argument types costs
    more than the snapshot itself, and the watcher calls this every two seconds.
    """
    global _process_api_cache
    if _process_api_cache is not _UNSET:
        return _process_api_cache
    if not _WINDOWS:
        _process_api_cache = None
        return None

    class _PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", ctypes.c_ulong),
            ("cntUsage", ctypes.c_ulong),
            ("th32ProcessID", ctypes.c_ulong),
            ("th32DefaultHeapID", ctypes.c_void_p),
            ("th32ModuleID", ctypes.c_ulong),
            ("cntThreads", ctypes.c_ulong),
            ("th32ParentProcessID", ctypes.c_ulong),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", ctypes.c_ulong),
            ("szExeFile", ctypes.c_wchar * _MAX_PATH),
        ]

    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateToolhelp32Snapshot.argtypes = [ctypes.c_ulong, ctypes.c_ulong]
        kernel32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
        kernel32.Process32FirstW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_PROCESSENTRY32W)]
        kernel32.Process32FirstW.restype = ctypes.c_int
        kernel32.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_PROCESSENTRY32W)]
        kernel32.Process32NextW.restype = ctypes.c_int
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_int
    except (OSError, AttributeError):
        _process_api_cache = None
        return None

    _process_api_cache = (kernel32, _PROCESSENTRY32W, ctypes.sizeof(_PROCESSENTRY32W))
    return _process_api_cache


def _toolhelp_names():
    """Lower-case exe names from one Toolhelp32 process snapshot, or None.

    None means "not available here" (non-Windows host, or the API call failed)
    and the caller falls back to `tasklist`. The snapshot is opened and closed
    inside this function so no handle leaks between calls.
    """
    api = _process_api()
    if api is None:
        return None
    kernel32, entry_type, entry_size = api

    snapshot = kernel32.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
    if not snapshot or snapshot == _INVALID_HANDLE:
        return None
    try:
        entry = entry_type()
        entry.dwSize = entry_size
        names = set()
        if not kernel32.Process32FirstW(snapshot, ctypes.byref(entry)):
            return None
        while True:
            names.add(entry.szExeFile.lower())
            if not kernel32.Process32NextW(snapshot, ctypes.byref(entry)):
                return names
    finally:
        kernel32.CloseHandle(snapshot)


def _tasklist_names():
    """Lower-case exe names from one `tasklist` call (fallback path)."""
    try:
        listing = subprocess.run(
            ["tasklist", "/NH", "/FO", "CSV"],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return set()
    names = set()
    for line in listing.splitlines():
        head = line.split(",", 1)[0].strip().strip('"')
        if head:
            names.add(head.lower())
    return names


def _running_names():
    """Lower-case exe names of every running process, one snapshot per call."""
    names = _toolhelp_names()
    if names is not None:
        return names
    return _tasklist_names()


def is_running(process_name):
    """True while the named process is running. Blocking, but ~1 ms."""
    return (process_name or "").lower() in _running_names()


def running_processes():
    """Return the names of every known Riot process currently running."""
    names = _running_names()
    return [name for name in PROCESS_NAMES if name.lower() in names]


def are_any_running():
    """True while any known process is running. Blocking."""
    return bool(running_processes())


def kill_all(names=None):
    """Force-kill every known (or given) process with taskkill /F /T.

    Spawns one taskkill per process name for fastest parallel termination.
    Each taskkill is non-blocking (Popen) so all kills fire simultaneously;
    the handles are returned so a caller that is about to relaunch something
    can wait for them (see `kill_and_wait`).
    """
    names = names or PROCESS_NAMES
    procs = []
    if not names:
        return procs
    for process_name in names:
        try:
            procs.append(
                subprocess.Popen(
                    ["taskkill", "/F", "/T", "/IM", process_name],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
            )
        except OSError:
            pass
    return procs


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


def kill_and_wait(names, timeout_s=KILL_TIMEOUT_S):
    """Force-kill the given processes and return once the kills have landed.

    Waiting for the target names to disappear is not enough on its own.
    `taskkill` is spawned asynchronously, so when nothing is running
    `wait_until_dead` returns at once - while the taskkill processes have not
    even executed yet. They then enumerate the process table a moment later,
    find the replacement the caller has just spawned, and kill it too. That
    is what made "launch profile" spawn a Riot Client whose launcher log
    stopped ~16 ms in, right after "Lock file was not detected", with no
    window and no error. Waiting for every taskkill to exit closes that
    window before the caller relaunches the client.
    """
    procs = kill_all(names)
    deadline = time.monotonic() + timeout_s
    for proc in procs:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            return False
    return wait_until_dead(names, timeout_s)


def shutdown_stop():
    """Stop the Riot Client only. Used when the app itself is closing.

    The game process is never part of this: VALORANT may be running from the
    launcher before or after RiotSwitcher started, and closing the switcher is
    not a request to close the game. `kill_all` stays reserved for an explicit
    profile switch, which really does need the client tree gone.
    """
    return kill_and_wait(RIOT_CLIENT_PROCESSES)


def terminate_valorant():
    """Close the game after the user confirmed the "Quit VALORANT?" prompt.

    Nothing calls this on its own: a switch and a sign-out both refuse while
    the game is up, and only the dialog's confirm button reaches it. Vanguard
    is not in `VALORANT_PROCESSES` and is never killed here.
    """
    return kill_and_wait(VALORANT_PROCESSES)
