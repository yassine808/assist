# Progress — RiotSwitcher

## Plan

- [x] Capture the live Riot session when a profile is created (both add paths)
- [x] Fix profile-card launch wiring (single `launch` source)
- [x] Fix invisible main window (`ready-to-show` race)
- [x] Add file-safety guard tests (Riot Client only, never VALORANT)
- [x] Wipe all app data and relaunch fresh
- [x] Redesign "Add Account": capture the live session when it is new, otherwise
      open a fresh Riot Client and auto-save the account on login
- [x] Map the detector's `canceled` status to a real UI phase (currently stuck)

## Log

### 2026-11-04 — session capture, window visibility, reset

- Goal: make saving and switching accounts actually work, verify it, then reset.
- Done:
  - `_capture_session()` in `src/backend/main.py`, wired into `create_profile`
    and `AccountDetector._finish`; `LastRunningProfile` only set when session
    files were really copied.
  - `HomeView` owns a single `launch` passed through `ProfileGrid` →
    `ProfileCard` (the card used to create a second `useProfileLaunch`).
  - `window.ts`: `ready-to-show` listener attached before `loadURL`, plus a
    visibility fallback; same fix for secondary view windows.
  - `tests/test_account_capture.py`, `tests/test_file_safety.py`,
    `src/renderer/src/components/ProfileGrid.test.tsx`.
  - README "Add Account" diagrams updated with the capture step.
- Verified: 111 pytest, 35 Vitest, typecheck, ESLint, Ruff, compileall,
  `npm run build`; live IPC showed `has_session: true`; window `RiotSwitcher`
  visible via Win32 enumeration.
- Done (reset): backed up `data/` to
  `%TEMP%\assist-backup-20261104-081335.zip`, deleted `data/` and
  `%APPDATA%\riotswitcher`, relaunched. Empty profile list, one backend
  process, no errors.
- Note: repeated `WinError 32` on `profiles_data.json.tmp` came from two
  backend processes sharing one data dir, not from `ProfileManager._write`
  (that path is already under an `RLock`).
- Next: redesign "Add Account" per the requested behaviour.

### 2026-11-04 — Add Account behaviour mapped

- Goal: document current behaviour before changing it.
- Done: traced `AddAccountModal.tsx`, `useAccountDetection.ts`,
  `account_detector.py`, `main.py`; wrote state machine, detector loop,
  side-effect table, and six issues to
  `C:\Users\Administrator\Desktop\AddAccount-behaviour.md`.
- Key issues found:
  - "Switch Account" on the suggest screen relaunches into the same unsaved
    account and re-prompts (credentials are never cleared there).
  - Two confirm UIs and two naming rules for the same action; no custom name.
  - `canceled` (300 s timeout) has no UI phase → modal stuck on "Opening…".
- Next: implement the new Add Account flow.

### 2026-11-04 — Add Account now captures or opens the client

- Goal: one-click add. Save the live session if it is new; otherwise open a
  fresh Riot Client and save the account the moment the user logs in.
- Done:
  - `capture_current_account` handler (`main.py`) reads the live JWT, skips
    already-saved accounts, creates a uniquely named profile, captures the
    session, and rolls the profile back if capture fails.
  - `unique_profile_name()` extracted in `account_detector.py` and shared by
    both add paths (no more duplicate names).
  - Detector `start_detection(auto_save=True)` (backend handler default) clears
    the live credentials before launching and saves a new login immediately —
    no confirmation step.
  - `AddAccountModal`: removed the suggest/save-prompt screens; the waiting
    screen now says "Waiting for login…" and tells the user the Riot Client is
    open; `canceled` maps to `error` instead of spinning forever.
  - Tests: auto-save detector, name dedup, handler dispatch.
- Verified: 115 pytest, 35 Vitest, typecheck, ESLint, Ruff, `npm run build`.
- Next: manual check of the new flow in the running app.
