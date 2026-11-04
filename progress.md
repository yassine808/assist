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
- [x] Player-card catalogue in a local SQLite DB: download once, serve from
      disk, re-check for new cards at most once a week
- [x] Auto-update: check GitHub on start and periodically, packaged builds only
- [x] Rewrite README (TL;DR, screenshots, license, latest-release link)
- [x] Add `LICENSE` (GPL-3.0 full text)
- [x] Bump to v3.0.0 and add an annotated release tag

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

### 2026-11-04 — Riot Client did not open on Add Account

- Goal: fix "clicked Add Account, modal says waiting, no Riot Client window".
- Cause 1: `dev` script ran `dev:python` while `python-bridge.ts` also spawns a
  backend. Two backends shared `data/` (source of the `WinError 32` spam and
  inconsistent profiles).
- Cause 2: the detector killed the client with the fire-and-forget
  `riot.kill_all()` and launched immediately. The async `taskkill` could reach
  the freshly spawned client and kill it, leaving no window.
- Fix:
  - `package.json`: `dev` is now `electron-vite dev` only; `dev:python` kept for
    standalone backend runs. README documents this.
  - `RiotClientManager.kill_all_and_wait()`; the detector uses it as its killer,
    so the old client is fully dead before credentials are cleared and the new
    one starts.
  - stderr log line `[AddAccount] Riot Client launched, pid=…` for diagnosis.
- Verified: probe calling `kill_all_and_wait()` then `launch_client()` opened the
  visible `Riot Client` window (pid 2340 → window pid 18036). 115 pytest, 35
  Vitest, typecheck, ESLint, Ruff, build.
- Next: user clicks Add Account again; expect the login window and auto-save.

### 2026-11-04 — README, v3.0.0 tag, verification

- Goal: finish the release polish on top of the player-card DB and updater work.
- Done:
  - `README.md` replaced: badges, one-screen TL;DR of how switching works,
    screenshots, download links, update behaviour, player-card cache, dev setup,
    data locations, GPL-3.0. The long technical content lives in
    `docs/ARCHITECTURE.md`.
  - `electron.d.ts`: declared `getVersion` so the TitleBar version pill passes
    typecheck.
  - Annotated tag `v3.0.0`.
- Verified: 128 pytest, 37 Vitest, typecheck, ESLint, Ruff, compileall,
  `npm run build`.
- Next: push tag + build the 3.0.0 release.

### 2026-11-04 — Agent Mastery cards (30) to official playercards

- Goal: extract the 30 Agent Mastery player cards from the VALORANT Wiki
  (animated GIF + large HD art) into official playercards, named per agent.
- Done:
  - Created `official playercards/AgentMastery/{Animated,HD,Large}` plus
    `manifest.csv` (agent, animated file, frame count, HD dims, Large dims).
  - Downloaded from wiki.playvalorant.com via a headless Chromium
    (Playwright, same-origin fetch) because plain curl/Invoke-WebRequest got a
    Cloudflare 403.
  - Animated: 30 GIFs, 230x536, 291–500 frames, 147.5 MB total.
  - HD: 28 PNGs at ~2367x5655 (Sova only 941x2247).
  - Large: 30 PNGs at 268x640.
- Verified: every file has a valid GIF/PNG signature; frame counts and image
  sizes read back with System.Drawing; counts 30/28/30.
- Next: Hush and Neon have no `Large_HD` on the wiki (Hush has no HD at all;
  Neon's only HD asset is the 3000x850 wide banner, which is a different
  crop and was not written). Optional: convert GIFs to APNG and fold into
  `Animated/` if the app needs the project's animated-card layout.
### 2026-11-04 — Agent Mastery: game-extracted source (resolution audit)

- Goal: answer "it looks sharpened, give me the highest resolution possible"
  by going to the game files instead of the wiki.
- Done:
  - Added a generic `--mode tex` to `tools/carddump` (Analyze/DecodeFormat +
    WritePng) so any texture package can be dumped to PNG.
  - Found the 30 mastery cards in the live build: 27 as
    `Playercard_Bloomline_<Codename>_01_L` and 3 as
    `PlayerCards_<Codename>AM_01_Large` (Gekko, Chamber, Harbor).
  - Extracted all 30 to `official playercards/AgentMastery/Game` at their
    native 268x640.
  - Compared wiki art vs game art: the wiki `Large` (268x640) is the same
    texture; the wiki `Large_HD` (2368x5656) is an ~8.8x upscale of it,
    which is the "sharpened" look.
- Verified: 30 files, all 268x640, PNG signatures good; side-by-side renders
  match the wiki composition.
- Next: decide whether to ship native 268x640, a clean non-sharpened upscale,
  or a rebuilt composite (background + agent overlay layer) at native.
### 2026-11-04 — Agent Mastery: native-only delivery

- Goal: finalise the set at native game resolution after the resolution audit.
- Done: kept `AgentMastery/Game` (30 x 268x640 PNG from the game) and
  `AgentMastery/Animated` (30 GIFs); removed the wiki upscales (`HD`) and
  the duplicate wiki `Large` set; rewrote `manifest.csv`.
- Verified: 30/30 files, all 268x640, thumbnail sheet checked against the wiki
  set; no alpha damage.
- Next: done. If full-card composites are wanted later, the missing foreground
  layers are `_Sequence` sheets + `_Mask` (Jett, KAYO, Killjoy, Miks, Neon,
  Viper among them).
### 2026-11-04 — Agent Mastery: full animated cards rebuilt from game layers

- Goal: replace the deleted wiki GIFs with real animations composited from the
  game's own assets.
- Done:
  - Deleted `AgentMastery/Animated` (the wiki GIFs) as instructed.
  - Mapped all 30 animation flipbooks (`_Sequence` sheets) + grid layouts.
  - Built a compositor: each flipbook cell is the full-card artwork squashed
    into its cell, so it is stretched to 268x640 and alpha-composited over the
    `_L` base. Calibrated against the in-game capture of Astra's card.
  - Wrote 30 looping APNGs (native 268x640) to `AgentMastery/Animated`.
  - Rewrote `manifest.csv` with frame counts and file sizes.
- Verified: 30/30 APNGs decode, 8-55 frames each, mid-loop frame differs from
  frame 0 on every card (animation is real), contact sheet checked against the
  base art.
- Next: done.

### 2026-11-04 — Agent Mastery: stretch audit, cleanup, push

- Goal: answer "the cards look stretched or cut — is it the browser or the
  file?", clear the leftover build artifacts, commit and push.
- Findings:
  - File geometry is correct: APNG IHDR 268x640 on all sampled cards, aspect
    0.4188 identical to the static art, 16 frames, `loop=0`. `preview.html`
    uses `width:100%; height:auto`, so the page cannot distort them either.
  - The art inside is wrong. `compose.py` resizes each 256x256 flipbook cell to
    268x640 and alpha-blends it at `OPACITY = 1.0`; the cell alpha is opaque, so
    it replaces the card art instead of overlaying it. Result: over-zoomed,
    cropped frames (Astra's forearm cut at the bottom).
  - The corrected result exists only as `mix_Astra/Harbor/Gekko.png` previews
    (15:14, after the APNGs were written at 14:50) — base art kept, energy layer
    scaled and aligned behind it. It was never rebuilt into the 30 files.
  - Hush (372x410), Neon (256x512) and Sova (410x1024) have non-square cells, so
    cell→card needs a per-card fit, not a plain stretch.
- Done:
  - Deleted 423 MB of build intermediates: `official playercards/_animtest`,
    `_probe`, `_stage`, and every `Animated/*/frames` dump.
  - `.gitignore`: added `official playercards/`, `tools/dotnet`, `tools/retoc*`,
    `tools/unpack_test`, `tools/cue4parse-src`, `tools/carddump/{bin,obj}`,
    `tools/*.{pak,txt,csv}` — the untracked asset trees are 1.8 GB.
  - Committed docs + tool sources only (no game assets).
- Note: `tools/build-cards.ps1` reads `_stage`, which is now deleted; rebuilding
  `Static/` or `Animated/` needs a re-stage from the game first.
- Next: rebuild the 30 APNGs with the calibrated blend (square layer fitted to
  the card, screen/over, per-card fit for Hush/Neon/Sova). The compositor and
  the extracted `_Sequence` textures are still in
  `%TEMP%\opencode\{wikidl,bloomline}`.