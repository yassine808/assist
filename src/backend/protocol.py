"""JSON-line protocol for the RiotSwitcher Python backend.

The backend communicates with the Electron main process over stdin/stdout
using one JSON object per line:

  Request:  {"id": 1, "method": "get_profiles", "params": {}}
  Response: {"id": 1, "result": {...}}
  Error:    {"id": 1, "error": "message"}
  Event:    {"event": "profile_created", "params": {...}}
"""

import io
import json
import sys
import threading

# Whether ensure_utf8_streams() has already run in this process. Guards against
# wrapping the streams twice, which would nest TextIOWrappers and, on exit,
# close the underlying buffer out from under the parent process.
_utf8_configured = False


def ensure_utf8_streams():
    """Force UTF-8 on stdin/stdout so non-ASCII profile names survive the pipe
    between Node.js (always UTF-8) and Python.

    This must be called from the process entry point, NOT at import time.
    Wrapping ``sys.stdout`` at import hijacks the interpreter's global streams
    for anyone who merely imports this module, and the wrapper closes the
    underlying buffer when it is collected -- which breaks the importing
    process's own output.
    """
    global _utf8_configured
    if _utf8_configured:
        return
    if hasattr(sys.stdin, "buffer"):
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    _utf8_configured = True


class Protocol:
    """Wraps the JSON-line protocol over a stdin/stdout pipe."""

    def __init__(self):
        self._lock = threading.Lock()

    def read_request(self):
        """Read a single request line from stdin. Returns parsed dict or None on EOF."""
        while True:
            line = sys.stdin.readline()
            if not line:
                return None
            line = line.strip()
            if not line:
                continue
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                sys.stderr.write(f"Invalid JSON request: {line}\n")

    def send_response(self, request_id, result=None, error=None):
        """Send a single response frame."""
        payload = {"id": request_id}
        if error is not None:
            payload["error"] = str(error)
        else:
            payload["result"] = result
        self._write(payload)

    def send_event(self, event, params=None):
        """Send an asynchronous event frame."""
        payload = {"event": event, "params": params}
        self._write(payload)

    def _write(self, payload):
        with self._lock:
            sys.stdout.write(json.dumps(payload) + "\n")
            sys.stdout.flush()
