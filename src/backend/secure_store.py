"""Encryption at rest for the saved Riot Client session backups.

A saved profile holds ``RiotGamesPrivateSettings.yaml`` and the ``Sessions``
folder copied out of the live Riot Client. Those files are login tokens: a
plaintext copy in the app's data folder would let any file viewer, another
Windows account, or a copied/synced folder replay the session.

On Windows the data is encrypted with DPAPI (``CryptProtectData``) in the
current user's scope, with a fixed application entropy value:

* the ciphertext is bound to **this Windows user on this machine** -- another
  account, another PC, or a copy of the folder cannot decrypt it;
* decryption also needs the app's entropy constant, so a generic "dump every
  DPAPI blob you can find" tool does not get the plaintext for free.

DPAPI is the OS primitive for "only this user, only here". It is not a vault
against a process that is already running as the same user (such a process can
call DPAPI too); the alternative -- a password the user types on every launch --
is the only stronger local option, and it breaks the switch-without-prompt flow.
Everything the app can do about tokens on disk, this does.

On a non-Windows host (development, CI) DPAPI is unavailable, so a per-install
Fernet key is kept in the data folder with owner-only permissions. That path is
never used by the shipped Windows build.
"""

import os
import stat
import sys

# Bumped only together with a migration: existing blobs were sealed with the old
# value and would stop decrypting.
_ENTROPY = b"RiotSwitcher.session.v1"

_MAGIC = b"RSENC1\n"

_CRYPTPROTECT_UI_FORBIDDEN = 0x1


class SecureStoreError(Exception):
    """Raised when data cannot be encrypted or decrypted."""


def _is_windows():
    return sys.platform.startswith("win")


if _is_windows():  # pragma: no cover - exercised on Windows only
    import ctypes
    from ctypes import wintypes

    class _DataBlob(ctypes.Structure):
        _fields_ = [
            ("cbData", wintypes.DWORD),
            ("pbData", ctypes.POINTER(ctypes.c_char)),
        ]

    def _make_blob(data):
        buffer = ctypes.create_string_buffer(data, len(data))
        blob = _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
        return blob, buffer

    _crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    _crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(_DataBlob),
        wintypes.LPCWSTR,
        ctypes.POINTER(_DataBlob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(_DataBlob),
    ]
    _crypt32.CryptProtectData.restype = wintypes.BOOL
    _crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(_DataBlob),
        ctypes.POINTER(wintypes.LPWSTR),
        ctypes.POINTER(_DataBlob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(_DataBlob),
    ]
    _crypt32.CryptUnprotectData.restype = wintypes.BOOL
    _kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    _kernel32.LocalFree.restype = ctypes.c_void_p

    def _dpapi(data, protect):
        in_blob, in_buffer = _make_blob(data)
        entropy_blob, entropy_buffer = _make_blob(_ENTROPY)
        out_blob = _DataBlob()
        if protect:
            ok = _crypt32.CryptProtectData(
                ctypes.byref(in_blob),
                None,
                ctypes.byref(entropy_blob),
                None,
                None,
                _CRYPTPROTECT_UI_FORBIDDEN,
                ctypes.byref(out_blob),
            )
        else:
            description = wintypes.LPWSTR()
            ok = _crypt32.CryptUnprotectData(
                ctypes.byref(in_blob),
                ctypes.byref(description),
                ctypes.byref(entropy_blob),
                None,
                None,
                _CRYPTPROTECT_UI_FORBIDDEN,
                ctypes.byref(out_blob),
            )
        # Keep the input buffers alive until the API call has returned.
        del in_buffer, entropy_buffer
        if not ok:
            raise SecureStoreError(
                f"DPAPI call failed with error {ctypes.get_last_error()}"
            )
        try:
            return ctypes.string_at(out_blob.pbData, out_blob.cbData)
        finally:
            _kernel32.LocalFree(out_blob.pbData)


class SecureStore:
    """Encrypts and decrypts blobs for the current user.

    ``key_dir`` is only touched on non-Windows hosts, where it holds the
    fallback Fernet key.
    """

    def __init__(self, key_dir=None):
        self._key_dir = key_dir
        self._fernet = None

    # -- public API -----------------------------------------------------

    def protect(self, data):
        if _is_windows():
            return _MAGIC + _dpapi(bytes(data), True)
        return _MAGIC + self._fallback_fernet().encrypt(bytes(data))

    def unprotect(self, blob):
        if not blob.startswith(_MAGIC):
            raise SecureStoreError("Not a RiotSwitcher encrypted blob")
        body = blob[len(_MAGIC):]
        if _is_windows():
            try:
                return _dpapi(body, False)
            except SecureStoreError:
                raise
            except Exception as err:  # noqa: BLE001
                raise SecureStoreError(str(err))
        try:
            return self._fallback_fernet().decrypt(body)
        except Exception as err:  # noqa: BLE001
            raise SecureStoreError(str(err))

    def encrypted(self, blob):
        return bool(blob) and blob.startswith(_MAGIC)

    # -- non-Windows fallback ------------------------------------------

    def _fallback_fernet(self):
        if self._fernet is not None:
            return self._fernet
        from cryptography.fernet import Fernet

        key_path = os.path.join(self._key_dir or ".", "local.key")
        os.makedirs(os.path.dirname(os.path.abspath(key_path)), exist_ok=True)
        if not os.path.isfile(key_path):
            key = Fernet.generate_key()
            handle = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(handle, "wb") as out:
                out.write(key)
            try:
                os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)
            except OSError:
                pass
        with open(key_path, "rb") as handle:
            self._fernet = Fernet(handle.read().strip())
        return self._fernet
