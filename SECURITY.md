# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private report form:
<https://github.com/yassine808/assist/security/advisories/new>

Include the version you tested, what an attacker could do, and the steps to
reproduce. I aim to reply within a week.

## Scope

RiotSwitcher reads and writes Riot Client session files on your own machine.
The parts worth testing:

- The Electron renderer and preload bridge (it can open external links and
  receive IPC).
- `src/backend/session_manager.py` and `secure_store.py` (session copying and
  DPAPI sealing).
- The updater (`src/main/updater.ts`) and the release pipeline.
- Anything that could write outside the Riot Client folders.

Out of scope: Riot's own client, Vanguard, and anything that requires an
already-compromised machine.

## Supported versions

Only the newest release gets fixes. Install updates through the app.
