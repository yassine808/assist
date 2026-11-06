"""Per-profile Riot Client session file management.

The Riot Client stores its login/session state in a small set of files and
directories under the user's LOCALAPPDATA and the install directory. To switch
profiles (accounts), the app saves these files into a per-profile backup
directory and restores them from that backup, replacing the live files.

Every file replacement is *temp-then-rename*: a copy is written to a temp
sibling and swapped into place only after it fully succeeds, so a failed or
interrupted operation never destroys the previous good backup or leaves the
live client files in a half-written state.

The backups are encrypted at rest (``secure_store``): these files are login
tokens, and a plaintext copy in the app's data folder would be replayable by
anyone who can read the folder. A directory backup is packed into a tar stream
and sealed as one blob; a single file is sealed as one blob. Both keep their
original names, and the payload is recognised by its magic header, so backups
written by an older build still restore.

This mirrors the original Godot ``ProfileManager.save/restore_profile_session``
semantics (see FILES_TO_SWITCH), including the deliberate exclusion of the
transient ``lockfile``.

Thread-safety: a single reentrant mutex guards all filesystem operations so
concurrent save/restore calls from the job worker and protocol loop cannot
interleave.
"""

import io
import os
import re
import shutil
import tarfile
import threading

import secure_store

# Riot Client files that carry login/session state and must be swapped per
# profile. NOTE: "lockfile" is intentionally excluded — it is transient and
# restoring a stale one breaks the client.
FILES_TO_SWITCH = [
    {
        "id": "private_settings",
        "filename": "RiotGamesPrivateSettings.yaml",
        "base": "local_app_data",
        "rel_path": r"Riot Games/Riot Client/Data/RiotGamesPrivateSettings.yaml",
    },
    {
        "id": "sessions_dir",
        "filename": "Sessions",
        "base": "local_app_data",
        "rel_path": r"Riot Games/Riot Client/Data/Sessions",
        "is_dir": True,
    },
    {
        "id": "riot_client_settings",
        "filename": "RiotClientSettings.yaml",
        "base": "local_app_data",
        "rel_path": r"Riot Games/Riot Client/Config/RiotClientSettings.yaml",
    },
    {
        "id": "client_config",
        "filename": "client.config.yaml",
        "base": "install_dir",
        "rel_path": r"Config/client.config.yaml",
    },
    {
        "id": "client_settings",
        "filename": "client.settings.yaml",
        "base": "install_dir",
        "rel_path": r"Config/client.settings.yaml",
    },
]

DIR_TMP_SUFFIX = "_tmp"
FILE_TMP_SUFFIX = ".tmp"

# The subset of FILES_TO_SWITCH that actually carries the live login. Clearing
# these signs the Riot Client out on its next start; the client's own Config
# files are left alone because they hold preferences, not the session.
LIVE_LOGIN_FILES = ("private_settings", "sessions_dir")


def sanitize_directory_name(name):
    """Produce a filesystem-safe directory name from a profile name.

    Mirrors the legacy sanitizer: keeps alphanumerics and spaces, replaces
    other characters with underscores, trims and collapses whitespace.
    """
    cleaned = re.sub(r"[^A-Za-z0-9 _\-]", "_", name or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.replace(" ", "_")
    return cleaned or "profile"


class SessionManager:
    """Owns session file backups per profile and swaps them in/out atomically."""

    def __init__(self, profiles_root, store=None):
        """profiles_root: directory that will hold each profile's backup folder."""
        self._root = profiles_root
        self._lock = threading.RLock()
        self._store = store or secure_store.SecureStore(
            os.path.dirname(os.path.abspath(profiles_root))
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def save_session(self, directory_name, riot_install_dir):
        """Copy the current live Riot Client files into a profile's backup dir.

        Returns True only if every present source file was backed up. Files
        that do not exist at the source are silently skipped (the profile's
        backup then simply lacks them).
        """
        profile_dir = self._profile_dir(directory_name)
        with self._lock:
            os.makedirs(profile_dir, exist_ok=True)
            all_success = True
            for file_def in FILES_TO_SWITCH:
                if not self._backup_one_file(file_def, profile_dir, riot_install_dir):
                    all_success = False
        return all_success

    def _backup_one_file(self, file_def, profile_dir, riot_install_dir):
        """Backup a single file/directory. Returns True on success or skip."""
        source = self._resolve_path(file_def, riot_install_dir)
        if not source:
            return True
        dest = os.path.join(profile_dir, file_def["filename"])
        if file_def.get("is_dir"):
            if not os.path.isdir(source):
                return True
            return self._seal_path(source, dest, is_dir=True)
        if not os.path.isfile(source):
            return True
        return self._seal_path(source, dest, is_dir=False)

    def restore_session(self, directory_name, riot_install_dir):
        """Write a profile's backed-up files over the live Riot Client files.

        Files the profile never backed up are removed from the live client so
        no stale session data survives. Every replacement is temp-then-rename,
        so a failed restore leaves the live client files intact. Returns True
        only if every restore succeeded.
        """
        profile_dir = self._profile_dir(directory_name)
        with self._lock:
            all_success = True
            for file_def in FILES_TO_SWITCH:
                if not self._restore_one_file(file_def, profile_dir, riot_install_dir):
                    all_success = False
        return all_success

    def _restore_one_file(self, file_def, profile_dir, riot_install_dir):
        """Restore a single file/directory from backup. Returns True on success."""
        dest = self._resolve_path(file_def, riot_install_dir)
        if not dest:
            return True
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        source = os.path.join(profile_dir, file_def["filename"])
        if os.path.isdir(source):
            # Legacy backup written before backups were encrypted.
            if file_def.get("is_dir"):
                return self._copy_dir_atomic(source, dest) == 0
            return True
        if os.path.isfile(source):
            payload = self._read_backup(source)
            if payload is None:
                return False
            if file_def.get("is_dir"):
                return self._extract_dir_atomic(payload, dest) == 0
            return self._write_bytes_atomic(payload, dest) == 0
        if file_def.get("is_dir"):
            if os.path.isdir(dest):
                return self._remove_dir_recursive(dest) == 0
            return True
        if os.path.isfile(dest):
            return self._remove_file(dest)
        return True

    def clear_live_session(self, riot_install_dir):
        """Delete the live Riot Client login so the next start is signed out.

        Used by the "sign out" action: only the LOCALAPPDATA login files are
        removed, never a game install and never the per-profile backups, so the
        account stays in the switcher and restoring it logs back in. The Riot
        Client must be stopped first, otherwise the files are locked.

        Returns True when every live login file is gone.
        """
        with self._lock:
            all_removed = True
            for file_def in FILES_TO_SWITCH:
                if file_def["id"] not in LIVE_LOGIN_FILES:
                    continue
                dest = self._resolve_path(file_def, riot_install_dir)
                if not dest:
                    continue
                if file_def.get("is_dir"):
                    if os.path.isdir(dest) and self._remove_dir_recursive(dest) != 0:
                        all_removed = False
                elif os.path.isfile(dest) and not self._remove_file(dest):
                    all_removed = False
        return all_removed

    def seal_existing_backups(self):
        """Encrypt any profile backup still stored as plaintext.

        Builds before ``secure_store`` wrote the session files straight into
        the profile folder, so an upgrade would otherwise leave a readable
        copy of every saved account's tokens on disk until that profile was
        switched again. Runs once at start-up, is idempotent, and never
        touches a backup that is already sealed.
        """
        with self._lock:
            if not os.path.isdir(self._root):
                return 0
            return self._seal_all_profiles()

    def _seal_all_profiles(self):
        """Walk the backup root and seal every profile it contains."""
        sealed = 0
        for entry in os.listdir(self._root):
            profile_dir = os.path.join(self._root, entry)
            if not os.path.isdir(profile_dir):
                continue
            sealed += self._seal_profile_backups(profile_dir)
        return sealed

    def _seal_profile_backups(self, profile_dir):
        """Seal the plaintext backups of one profile. Returns how many were sealed."""
        sealed = 0
        for file_def in FILES_TO_SWITCH:
            sealed += self._seal_backup_if_plaintext(profile_dir, file_def)
        return sealed

    def _seal_backup_if_plaintext(self, profile_dir, file_def):
        """Seal one backup when it is still plaintext. Returns 1 when sealed."""
        path = os.path.join(profile_dir, file_def["filename"])
        try:
            if file_def.get("is_dir"):
                if os.path.isdir(path) and self._seal_path(path, path, is_dir=True):
                    return 1
            elif (
                os.path.isfile(path)
                and not self._is_sealed_file(path)
                and self._seal_path(path, path, is_dir=False)
            ):
                return 1
        except OSError:
            pass
        return 0

    def _is_sealed_file(self, path):
        try:
            with open(path, "rb") as handle:
                return self._store.encrypted(handle.read(16))
        except OSError:
            return False

    def delete_profile_dir(self, directory_name):
        """Remove a profile's backup directory."""
        profile_dir = self._profile_dir(directory_name)
        with self._lock:
            if os.path.isdir(profile_dir):
                self._remove_dir_recursive(profile_dir)
            return not os.path.isdir(profile_dir)

    def profile_dir(self, directory_name):
        return self._profile_dir(directory_name)

    # ------------------------------------------------------------------
    # Path resolution
    # ------------------------------------------------------------------

    def _profile_dir(self, directory_name):
        return os.path.join(self._root, sanitize_directory_name(directory_name))

    @staticmethod
    def _resolve_path(file_def, riot_install_dir):
        base = file_def.get("base")
        rel = file_def["rel_path"]
        if base == "local_app_data":
            local = os.environ.get("LOCALAPPDATA", "")
            if not local:
                return ""
            return os.path.join(local, *rel.split("/"))
        if base == "install_dir":
            if not riot_install_dir:
                return ""
            return os.path.join(riot_install_dir, *rel.split("/"))
        return ""

    # ------------------------------------------------------------------
    # Encrypted backup blobs
    # ------------------------------------------------------------------

    def _seal_path(self, source, dest, is_dir):
        """Seal a file/directory into `dest`. Returns True on success."""
        try:
            if is_dir:
                buffer = io.BytesIO()
                with tarfile.open(fileobj=buffer, mode="w") as archive:
                    archive.add(source, arcname=".")
                payload = buffer.getvalue()
            else:
                with open(source, "rb") as handle:
                    payload = handle.read()
            sealed = self._store.protect(payload)
        except (OSError, secure_store.SecureStoreError, tarfile.TarError):
            return False
        return self._write_bytes_atomic(sealed, dest) == 0

    def _read_backup(self, path):
        """Return the plaintext payload of a backup file, or None on failure."""
        try:
            with open(path, "rb") as handle:
                blob = handle.read()
            if not self._store.encrypted(blob):
                # Legacy plaintext file backup written by an older build.
                return blob
            return self._store.unprotect(blob)
        except (OSError, secure_store.SecureStoreError):
            return None

    def _extract_dir_atomic(self, payload, dest_path):
        tmp_path = dest_path + DIR_TMP_SUFFIX
        if os.path.isdir(tmp_path):
            self._remove_dir_recursive(tmp_path)
        try:
            os.makedirs(tmp_path, exist_ok=True)
            with tarfile.open(fileobj=io.BytesIO(payload), mode="r") as archive:
                for member in archive.getmembers():
                    if not self._member_is_within(tmp_path, member.name):
                        return 1
                archive.extractall(tmp_path)
        except (OSError, tarfile.TarError):
            self._remove_dir_recursive(tmp_path)
            return 1
        if os.path.isdir(dest_path) and self._remove_dir_recursive(dest_path) != 0:
            return 1
        if self._rename_with_retry(tmp_path, dest_path) == 0:
            return 0
        self._remove_dir_recursive(tmp_path)
        return 1

    @staticmethod
    def _member_is_within(root, name):
        """Reject absolute paths and `..` escapes in a tar member name."""
        target = os.path.abspath(os.path.join(root, name))
        root = os.path.abspath(root)
        return target == root or target.startswith(root + os.sep)

    def _write_bytes_atomic(self, data, dest_path):
        tmp_path = dest_path + FILE_TMP_SUFFIX
        try:
            if os.path.isfile(tmp_path):
                os.remove(tmp_path)
            with open(tmp_path, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        except OSError:
            return 1
        if os.path.isdir(dest_path):
            # Replacing a legacy plaintext directory backup with a sealed file.
            if self._remove_dir_recursive(dest_path) != 0:
                return 1
        elif os.path.isfile(dest_path):
            try:
                os.remove(dest_path)
            except OSError:
                return 1
        if self._rename_with_retry(tmp_path, dest_path) == 0:
            return 0
        try:
            shutil.copy2(tmp_path, dest_path)
            os.remove(tmp_path)
            return 0
        except OSError:
            return 1

    # ------------------------------------------------------------------
    # Atomic helpers
    # ------------------------------------------------------------------

    def _copy_file_atomic(self, source_path, dest_path):
        tmp_path = dest_path + FILE_TMP_SUFFIX
        if os.path.isfile(tmp_path):
            os.remove(tmp_path)
        try:
            shutil.copy2(source_path, tmp_path)
        except OSError:
            return 1
        if os.path.isfile(dest_path):
            try:
                os.remove(dest_path)
            except OSError:
                return 1
        if self._rename_with_retry(tmp_path, dest_path) == 0:
            return 0
        try:
            shutil.copy2(tmp_path, dest_path)
            os.remove(tmp_path)
            return 0
        except OSError:
            return 1

    def _copy_dir_atomic(self, source_path, dest_path):
        tmp_path = dest_path + DIR_TMP_SUFFIX
        if os.path.isdir(tmp_path):
            self._remove_dir_recursive(tmp_path)
        if self._copy_dir_recursive(source_path, tmp_path) != 0:
            self._remove_dir_recursive(tmp_path)
            return 1
        if os.path.isdir(dest_path) and self._remove_dir_recursive(dest_path) != 0:
            return 1
        if self._rename_with_retry(tmp_path, dest_path) == 0:
            return 0
        if self._copy_dir_recursive(tmp_path, dest_path) == 0:
            self._remove_dir_recursive(tmp_path)
            return 0
        return 1

    @staticmethod
    def _rename_with_retry(old_path, new_path):
        for _ in range(3):
            try:
                os.rename(old_path, new_path)
                return 0
            except OSError:
                import time
                time.sleep(0.1)
        return 1

    @staticmethod
    def _copy_dir_recursive(source_path, dest_path):
        try:
            shutil.copytree(source_path, dest_path, dirs_exist_ok=True)
            return 0
        except OSError:
            return 1

    @staticmethod
    def _remove_dir_recursive(path):
        import time
        for _ in range(3):
            try:
                shutil.rmtree(path)
                return 0
            except OSError:
                time.sleep(0.1)
        return 0 if not os.path.exists(path) else 1

    @staticmethod
    def _remove_file(path):
        """Remove a file, returning True if it is gone (or was never there)."""
        for _ in range(3):
            try:
                if os.path.isfile(path):
                    os.remove(path)
                return not os.path.exists(path)
            except OSError:
                import time
                time.sleep(0.1)
        return not os.path.exists(path)
