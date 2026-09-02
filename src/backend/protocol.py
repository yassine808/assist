"""JSON-line protocol for the RiotSwitcher Python backend.

The backend communicates with the Electron main process over stdin/stdout
using one JSON object per line:

  Request:  {"id": 1, "method": "get_profiles", "params": {}}
  Response: {"id": 1, "result": {...}}
  Error:    {"id": 1, "error": "message"}
  Event:    {"event": "profile_created", "params": {...}}
"""

import json
import sys
import threading


class Protocol:
    """Wraps the JSON-line protocol over a stdin/stdout pipe."""

    def __init__(self):
        self._lock = threading.Lock()

    def read_request(self):
        """Read a single request line from stdin. Returns parsed dict or None on EOF."""
        line = sys.stdin.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            return self.read_request()
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            sys.stderr.write(f"Invalid JSON request: {line}\n")
            return self.read_request()

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
