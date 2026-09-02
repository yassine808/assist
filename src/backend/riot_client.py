"""Riot Client lifecycle management.

Owns everything about starting and stopping the Riot Client: locating the
install, building launch arguments from the LaunchProduct setting, killing the
running processes, waiting for them to fully exit, and launching the client.

Replaces the process/kill/launch concerns that lived in Godot's
RiotProcesses + ProfileGridController. Session-file swapping and profile
selection are wired in during Step 5; the launch primitive and argument builder
live here so the UI can reuse them.
"""

import json
import os
import subprocess
import threading

import riot_processes as rp

CLIENT_EXE = "RiotClientServices.exe"

# Launch product values (matches the LaunchProduct setting).
LAUNCH_PRODUCT_RIOT = "riot"       # Riot client only, no game auto-launch.
LAUNCH_PRODUCT_VALORANT = "valorant"  # Auto-launch VALORANT after the client.
DEFAULT_LAUNCH_PRODUCT = LAUNCH_PRODUCT_VALORANT

# Static flags always passed to the client.
BASE_LAUNCH_ARGS = ["--launch-patchline=live"]

# Riot's canonical install manifest and metadata YAML.
RIOT_INSTALLS_JSON = r"C:/ProgramData/Riot Games/RiotClientInstalls.json"
RIOT_METADATA_YAML = r"C:/ProgramData/Riot Games/Metadata/Riot Client/Riot Client.product_settings.yaml"

# Registry keys where Riot registers install locations. Used for games; the
# Riot Client folder is derived as a sibling under <drive>/Riot Games/.
RIOT_GAME_REG_KEYS = [
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game valorant.live",
    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game valorant.live",
    r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game valorant.live",
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game league_of_legends.live",
    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game league_of_legends.live",
]

COMMON_DRIVES = ["D:", "C:", "E:", "F:", "G:"]
COMMON_INSTALL_PATH = r"/Riot Games/Riot Client"

# Riot Client installs JSON carries the associated-game install path; the
# client's own folder is a sibling of those games under <drive>/Riot Games/.



class RiotClientError(Exception):
    """Raised when the Riot Client cannot be located or launched."""


def _reg_install_location(reg_key):
    """Query a registry InstallLocation value, returning "" when absent."""
    try:
        result = subprocess.run(
            ["reg", "query", reg_key, "/v", "InstallLocation"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    if result.returncode != 0:
        return ""
    for line in result.stdout.splitlines():
        if "InstallLocation" in line and "REG_SZ" in line:
            parts = line.split("REG_SZ", 1)
            if len(parts) >= 2:
                return parts[1].strip()
    return ""


class RiotClientManager:
    """Locates, kills, waits for, and launches the Riot Client."""

    def __init__(self, config, client_exe=CLIENT_EXE):
        self._config = config
        self._client_exe = client_exe
        self._job_lock = threading.Lock()
        self._thread = None
        self._jobs = []
        self._last_error = None
        self._listener = None
        self._launch_args_provider = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_listener(self, listener):
        """listener(status) is called after each kill/wait transition."""
        self._listener = listener

    def set_launch_args_provider(self, provider):
        """provider(launch_args) -> launch_args, called before launching.

        Used by the presence manager to inject --client-config-url when the
        Deceive proxy is active.
        """
        self._launch_args_provider = provider

    def get_location(self):
        return str(self._config.get("RiotClientLocation", "") or "")

    def detect_install_dir(self):
        """Auto-locate the Riot Client install directory via install manifests,
        registry, metadata YAML, and common drive locations.

        Returns the absolute folder containing RiotClientServices.exe, or ""
        if it cannot be found.
        """
        # 1. Riot Client installs JSON -> <drive>/Riot Games/Riot Client.
        for candidate in self._client_dirs_from_installs_json():
            if self._is_client_dir(candidate):
                return candidate

        # 2. Registry InstallLocation of associated games -> sibling Riot Client.
        for key in RIOT_GAME_REG_KEYS:
            location = _reg_install_location(key)
            if location:
                # Game install -> parent Riot Games dir -> sibling Riot Client.
                parent = os.path.dirname(location.replace("\\", "/"))
                candidate = os.path.join(parent, "Riot Client").replace("\\", "/")
                if self._is_client_dir(candidate):
                    return candidate

        # 3. Metadata YAML product_install_full_path(sibling of Riot Client).
        for candidate in self._client_dirs_from_metadata_yaml():
            if self._is_client_dir(candidate):
                return candidate

        # 4. Common drive locations.
        for drive in COMMON_DRIVES:
            candidate = f"{drive}/Riot Games/Riot Client"
            if self._is_client_dir(candidate):
                return candidate

        return ""

    def ensure_location(self):
        """Return the configured client location, auto-detecting it if unset.
        Raises RiotClientError if it still cannot be found."""
        location = self.get_location()
        if not location:
            detected = self.detect_install_dir()
            if detected:
                self._config.set("RiotClientLocation", detected)
                location = detected
        if not location:
            raise RiotClientError("Riot Client location is not set")
        return location

    # ------------------------------------------------------------------
    # Install discovery helpers
    # ------------------------------------------------------------------

    def _is_client_dir(self, folder):
        if not folder or not os.path.isdir(folder):
            return False
        return os.path.isfile(os.path.join(folder, self._client_exe))

    def _client_dirs_from_installs_json(self):
        """Derive candidate Riot Client install dirs from RiotClientInstalls.json.

        The JSON maps associated games to their install paths under
        <drive>/Riot Games/<game>. From any such path the client is its sibling
        at <drive>/Riot Games/Riot Client. Also handles keys that directly name
        a "Riot Client" path.
        """
        candidates = []
        if not os.path.isfile(RIOT_INSTALLS_JSON):
            return candidates
        try:
            with open(RIOT_INSTALLS_JSON, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return candidates
        if not isinstance(data, dict):
            return candidates

        paths = set()
        associated = data.get("associated_client", {})
        if isinstance(associated, dict):
            for path_key in associated.keys():
                paths.add(str(path_key).replace("\\", "/").rstrip("/"))
        for key, value in data.items():
            if isinstance(value, str) and "Riot" in str(value):
                paths.add(str(value).replace("\\", "/").rstrip("/"))

        for p in paths:
            if not p:
                continue
            if p.lower().endswith("riot client"):
                candidates.append(p)
                continue
            parent = os.path.dirname(p)
            candidates.append(os.path.join(parent, "Riot Client").replace("\\", "/"))
        return candidates

    def _client_dirs_from_metadata_yaml(self):
        """Candidates derived from the Riot Client metadata YAML install path."""
        paths = []
        if not os.path.isfile(RIOT_METADATA_YAML):
            return paths
        try:
            with open(RIOT_METADATA_YAML, "r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    stripped = line.strip()
                    if stripped.startswith("product_install_full_path:"):
                        parts = stripped.split(":", 1)
                        if len(parts) >= 2:
                            path = parts[1].strip().strip('"').strip("'")
                            path = path.replace("\\", "/").rstrip("/")
                            paths.append(path)
                            if not path.lower().endswith("riot client"):
                                parent = os.path.dirname(path)
                                paths.append(os.path.join(parent, "Riot Client").replace("\\", "/"))
        except OSError:
            pass
        return paths

    def set_location(self, folder):
        """Validate that RiotClientServices.exe exists, then persist.

        Returns the resolved executable path, or raises RiotClientError.
        """
        folder = (folder or "").strip()
        if not folder or not os.path.isdir(folder):
            raise RiotClientError("Riot Client folder does not exist")
        exe = os.path.join(folder, self._client_exe)
        if not os.path.isfile(exe):
            raise RiotClientError(f"{self._client_exe} not found in the selected folder")
        self._config.set("RiotClientLocation", folder)
        return exe

    def get_launch_product(self):
        value = str(self._config.get("LaunchProduct", DEFAULT_LAUNCH_PRODUCT))
        return value if value in (LAUNCH_PRODUCT_RIOT, LAUNCH_PRODUCT_VALORANT) else DEFAULT_LAUNCH_PRODUCT

    def build_launch_args(self):
        """Build the Riot Client launch arguments from the saved setting."""
        args = list(BASE_LAUNCH_ARGS)
        product = self.get_launch_product()
        args.insert(0, f"--launch-product={product}")
        return args

    def launch_client(self):
        """Spawn the Riot Client with the configured launch arguments.

        The client location is auto-detected if not yet configured. Returns the
        PID on success. Raises RiotClientError if the client cannot be located
        or fails to spawn.
        """
        exe = self.ensure_location()
        client_path = os.path.join(exe, self._client_exe)
        if not os.path.isfile(client_path):
            raise RiotClientError(f"{self._client_exe} not found in the selected folder")
        try:
            proc = subprocess.Popen(
                [client_path] + self.get_resolved_launch_args(),
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except OSError as exc:
            raise RiotClientError(f"Failed to launch Riot Client: {exc}") from exc
        return proc.pid

    def get_resolved_launch_args(self):
        """Launch args after applying the presence provider (if any)."""
        args = self.build_launch_args()
        if self._launch_args_provider is not None:
            args = self._launch_args_provider(args)
        return args

    def is_running(self):
        """True while any known Riot process is running."""
        return rp.are_any_running()

    def status(self):
        """Return a snapshot of what is currently running."""
        running = rp.running_processes()
        return {
            "running": bool(running),
            "processes": running,
            "client_location": self.get_location(),
            "launch_product": self.get_launch_product(),
            "launch_args": self.build_launch_args(),
            "resolved_launch_args": self.get_resolved_launch_args(),
        }

    # ------------------------------------------------------------------
    # Non-blocking control
    # ------------------------------------------------------------------

    def kill_all(self):
        """Queue a background taskkill for every Riot process."""
        self._enqueue("kill")

    def stop_and_wait(self):
        """Queue a background kill followed by a wait-until-all-dead drain."""
        self._enqueue("stop")

    def _emit(self, status):
        if self._listener:
            try:
                self._listener(status)
            except Exception:  # noqa: BLE001
                pass

    def _enqueue(self, kind):
        with self._job_lock:
            self._jobs.append(kind)
            if not self._thread or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._worker, daemon=True)
                self._thread.start()

    def _worker(self):
        while True:
            with self._job_lock:
                if not self._jobs:
                    break
                kind = self._jobs.pop(0)
            if kind == "kill":
                rp.kill_all()
                self._emit("killed")
            elif kind == "stop":
                rp.kill_all()
                ok = rp.wait_until_all_dead()
                self._last_error = None if ok else "Timed out waiting for Riot processes to exit."
                self._emit("stopped" if ok else "stop_failed")
