"""Shared pytest configuration.

Puts ``src/`` on ``sys.path`` so tests can use the same ``from backend.X
import Y`` imports the backend itself uses, and stubs the modules that only
exist inside the packaged Electron app (``riot_account_detect`` is a compiled
addon) so importing ``main`` does not explode in CI.

``src/backend`` is added as well: several backend modules use flat imports
(``from henrik_client import ...``) because that directory is the script root
when the app launches ``python src/backend/main.py``. Tests need the same
resolution the app gets.
"""

import os
import sys
from unittest import mock

_TESTS = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_TESTS)

for _path in (os.path.join(_ROOT, "src"), os.path.join(_ROOT, "src", "backend")):
    if _path not in sys.path:
        sys.path.insert(0, _path)

# Only present inside the packaged app, not in a source checkout.
sys.modules.setdefault("riot_account_detect", mock.MagicMock())
