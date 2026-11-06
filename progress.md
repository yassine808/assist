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
- [x] Customize playercard: Normal / Animated categories (local APNGs)
- [x] Auto-update: check GitHub on start and periodically, packaged builds only
- [x] Rewrite README (TL;DR, screenshots, license, latest-release link)
- [x] Add `LICENSE` (GPL-3.0 full text)
- [x] Bump to v3.0.0 and add an annotated release tag
- [x] App exit stops neither VALORANT nor the Riot Client; remove the
      VALORANT-killing helpers and IPC methods
- [x] Store app data in `C:\ProgramData\RiotSwitcher`, move legacy `%APPDATA%`
      data once, and restrict the folder ACL
- [x] Remove the Import/Export backup option (UI, IPC handlers, modal, tests)
- [x] Verify the clean favicon and rebuild the installer + portable with all
      30 animated cards
- [x] Remove the maximum window-width cap, keep the minimum size
- [x] Use the supplied chevron icon for the Electron window and taskbar
- [x] Make the minimum window width fit four profile cards per row
- [x] Move the version label from the title bar into Settings
- [x] Pause every animation while the window is backgrounded or unfocused
- [x] Add CI quality gates and a project-specific API-key leak check
- [x] Rebuild the 3.1.1 installer + portable with the sealed key and 30 cards

## Log

### 2026-11-05 — Add Account reminder image, 3-step list removed

- Goal: when "Add Account" opens the Riot Client, show the sign-in screenshot
  (Stay signed in ticked) instead of the 3-step instruction list, and keep the
  modal minimal.
- Done: `AddAccountModal` waiting screen is now the sign-in image plus two
  live steps: step 1 has a spinner on the left and switches between
  `Closing Riot Client…`, `Opening Riot Client…`, then a green check with
  `Riot Client ready`; step 2 shows an ear (listener) icon and `Waiting for login`,
  highlighted once the client is ready. `account_detector._run` and
  `_handle_already_added` now emit explicit `closing` / `opening` progress
  events; the hook's initial status is `opening`. The old status line and the
  `aa-step` / `aa-radar` / `aa-status-dot` markup and CSS are gone. Image
  bundled from `src/renderer/src/assets/stay-signed-in.png`; `env.d.ts`
  declares PNG imports.
- Verified: web typecheck clean, ESLint clean on the touched files, 27 Vitest
  pass, 128 pytest pass, Ruff + compileall clean, `npm run build` bundles
  `stay-signed-in-*.png`. (`npm run typecheck` still fails on the pre-existing
  `window.singleton.test.ts` missing exports; `npm run lint` still flags the
  pre-existing `ProfileGrid` / `SettingsView` hooks rules.)
- Next: manual check of the Add Account modal in the running app.

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

### 2026-11-04 — Animated cards fixed and added to the Customize picker

- Goal: make the shipped APNGs look like the real in-game cards, then offer
  them as an "Animated" category next to the normal cards.
- Fix:
  - Rebuilt all 30 APNGs. Placement rule taken from the wiki's animated cards
    (`Astra/Jett/Fade/Neon/Sova/KAYO` downloaded as reference, best variant
    picked per card): square cell → scale 1.10, anchor (-6, 36); non-square
    cell → stretch to 268x640. Alpha-over blending.
  - Result matches the wiki for Astra (mean abs error 48 vs 70 for the base
    alone) and keeps the same framing for every other card.
  - `tools/cards/compose.py` + `tools/cards/build_mastery.py` reproduce the
    files byte-for-byte from `CARDS_TEX`.
  - `manifest.csv` rewritten with the new frame counts and sizes.
- Feature:
  - `src/main/playercards.ts`: `card://` scheme serving the APNGs from
    `official playercards/AgentMastery/Animated` (dev) or
    `resources/playercards/animated` (packaged); `cards:animated` IPC lists
    them. Chosen over `file://` because the renderer runs on an http origin in
    dev and the page CSP only allows `card:`.
  - `PlayerCardPicker`: Normal / Animated tabs with counts, per-category search
    and Random; picking an animated card stores its `card://` URL as the
    profile's card art, so the lobby card animates.
  - `electron-builder.yml`: the 30 APNGs are copied to `playercards/animated`.
- Verified: typecheck, ESLint, 41 Vitest, 128 pytest, `npm run build`; a real
  Electron renderer loaded `card://animated/Astra_Mastery_Card_animated.apng`
  under the production CSP at 268x640; 30/30 APNGs decode, loop, and differ
  between frames.
- Note: the running app (started 16:10) predates these changes and needs a
  restart to show the new tab.
- Next: done.
### 2026-11-04 — overlay placement fixed (was stretched over full card)
- Goal: explain and fix the stretched/cropped look of the 30 animated mastery cards.
- Found: the files were 268x640 with correct aspect and preview.html cannot
  distort them, but compose.py resized each square flipbook cell to 268x640.
  That is a 2.4x vertical stretch of art drawn for a square.
- Proof: the in-game Astra lobby capture. A fit of the cell to that capture
  (NCC 0.83, landmarks within 2%) puts the overlay in a 284x343 box at (-8,-2),
  not across the whole card. At full stretch the capture scores 0.08.
- Cross-check: at 284x343 the overlay lines up with the game's own static _L
  art for all tested agents (no doubling in 50% blends); the game _S
  thumbnails share the same scale.
- Done: compose.py now pastes the cell into that box (FIT_SX/SY/OX/OY) and all
  30 APNGs were rebuilt at 268x640, 66 ms/frame, loop=0.
- Verified: every file 268x640; loop continuity unchanged (loopjam ~= avgstep);
  Astra frame 0 matches the lobby capture side by side; manifest.csv sizes
  refreshed; preview reopened in Brave.
- Next: none.

### 2026-11-04 — Customize playercard: Normal / Animated categories

- Goal: make the animated Agent Mastery cards selectable in the "Customize
  playercard" dialog, split into Normal (online catalogue) and Animated
  (30 local APNGs) categories.
- Done:
  - `src/main/playercards.ts`: `card://` scheme serving
    `AgentMastery/Animated`, `cards:animated` IPC, dev + packaged paths.
  - `PlayerCardPicker`: category tabs with counts, per-category tile shape
    (portrait 67/160 for animated cards, 3/4 for normal), filter resets on
    switch, selection still goes through `set_playercard`.
  - Hardened the protocol handler: 404 instead of a rejected `net.fetch` for
    missing files, and a `relative()` inside-folder check so `../` and
    sibling-folder (`animated2/`) paths cannot escape the card folder.
  - Tests: `PlayerCardPicker.test.tsx` (category switch, apply animated card,
    current-card highlight); 40 Vitest total.
- Verified: all 30 APNGs carry an `acTL` chunk; live Electron probe returned
  `200 image/apng` (3,321,707 B) for Astra and `404` for missing/traversal/
  sibling paths; typecheck, ESLint, 40 Vitest, `npm run build`.
- Note: `official playercards/` is gitignored, so a release build needs the
  assets staged locally for `extraResources` to include them.
- Next: manual visual check of the Animated tab in the running app.

### 2026-11-04 - Agent Mastery cards re-extracted from the local game install

- Goal: rebuild all 30 Agent Mastery player cards and their animations from the
  local VALORANT build instead of the wiki, with exact pixel coordinates.
- Done:
  - 	ools/carddump gained props, params (NameMap dump), a fixed nested
    savepkg write and an honoured --limit in list.
  - All 30 card packages located under
    ShooterGame/Content/Personalization/PlayerCards/Bloomline/* and every
    texture dumped at native size into official playercards/AgentMastery/Extracted/.
  - Per agent: card.png (268x640, whole card art), nimation.png (native
    flipbook atlas), rames/fNNN.png (every cell at its exact sheet rect),
    info.json (pixel x/y/w/h plus u/v per frame), 	extures/ (all source
    textures), plus a top-level index.json.
- Verified: 30/30 agents. 28 cards use a uniform grid (16 frames of 256x256,
  or 512x512, KAYO 8, Neon 256x512); Hush is 4096x2048 cut 11x5 = 55 frames of
  372x409 (fractional 4096/11, 2048/5, boundaries rounded); Sova 2048x2048 cut
  5x2 = 10 frames. Frame alpha channels are byte-identical (NCC 1.000000) to
  the independent 2026 APNG set for every uniform-grid card, and RGB NCC is
  0.998 for Hush/Sova, so grid, offsets and frame order are confirmed.
  Contact sheets checked visually for all 30 cards and all frame 0s.
- Not obtained: the overlay rect (X/Y/scale of the flipbook on the card quad).
  It is not in the _UIData blueprint (strings only) and the
  Materials/Playercard_<X>_MI actor is unversioned, so CUE4Parse returns no
  properties without a .usmap; the tagged property stream could not be walked
  by hand either.
- Next: none for extraction. Decide whether the app needs a composite (which
  would need the overlay rect) or the native parts as shipped.

### 2026-11-05 - Agent Mastery animated previews

- Goal: make the composited (animated) cards look right, since the first pass
  drew the flipbook at scale 1.10 anchored (-6, 36) and most cards looked off.
- Done:
  - Tried to recover the true overlay rect from the game: _Mask/_Alpha are
    card-space effect masks, not placement; _MI property stream still
    undecodable (encrypted/unversioned); correlation of frame 0 against the base
    art is degenerate (no shared structure).
  - Switched to a uniform, non-distorting rule: fit the cell inside the card art
    area (268x576), centred at 46% height, alpha-over the base. Rebuilt all 30
    animated cards as 268x640 animated WebP (66 ms/frame) in
    Extracted/animated/.
  - New pages: preview_animated.html (baked), preview_placement.html
    (live scale/x/y tuner).
- Verified: 30 files, correct frame count and 66 ms ANMF duration, 268x640;
  full contact sheet inspected for all 30 composites.
- Next: per-card nudges if Yassine flags specific agents.

### 2026-11-05 - Reset: tools and all extracted card assets deleted

- Goal: wipe the old extraction toolchain and card asset trees, start over.
- Done: deleted `tools/` (8194 files, 0.90 GB) and `official playercards/`
  (2189 files, 0.75 GB) after Yassine chose to drop the uncommitted
  `tools/carddump/Program.cs` edits.
- Verified: both paths gone (`Test-Path` false); `git status` shows 36 tracked
  deletions (30 `Extracted/animated/*.webp` + 6 tool sources) — not staged.
- Still pointing at the deleted data: `src/main/playercards.ts` (dev path) and
  `electron-builder.yml` (`extraResources: official playercards/AgentMastery/Animated`).
- Next: decide the new extraction approach, then re-point those two references.

### 2026-11-05 - Agent Mastery placement, second pass

- Goal: fix the composited cards flagged as wrong (Iso, Hush, Harbor, Killjoy and
  most of the rest).
- Done:
  - Compared contain / cover / cover-art against the base art for every card.
    Cover (fill the 268x640 card, aspect kept, crop overflow) is the only rule
    that puts the layers where the art expects them: Harbor's gauntlet meets the
    sleeve at the top, Hush's diamond floats over the hand, Killjoy's gun reads
    as the card's subject, Iso's pattern continues to the edges.
  - Rebuilt all 30 animated WebP at quality 92 (cover rule) and regenerated
    preview_animated.html, preview_placement.html (now a cover-baseline tuner)
    and preview_all.html.
- Verified: first frame of every baked file checked against the expected
  composite (NCC 0.996-0.999, lossy WebP), 268x640, frame counts 8/10/16/55 as
  extracted; 30-card contact sheet built from the shipped WebP files inspected.
- Next: per-card overrides if a specific agent still looks off.

### 2026-11-05 - Deadlock Bloomline animated card

- Goal: place the Deadlock BLOOMLINE flipbook correctly, add it to the app.
- Done:
  - Corrected quad is anisotropic: `pos(6.3, 21.2, 255.4, 549.8)` in 268x640.
  - Kept `PlayerCards/` with only REPORT.md, material params and the APNG.
  - Added `official playercards/AgentMastery/Animated/Deadlock_Mastery_Card_animated.apng`
    (16 frames, 206 ms each, 3.296 s loop).
- Verified: `listAnimatedCards` naming resolves the file to `Deadlock`;
  APNG is 268x640, 16 frames, constant 206 ms.
- Next: none.

### 2026-11-05 - Remaining 29 Agent Mastery animated cards

- Goal: build every other mastery card with the Deadlock material-parameter
  placement (anisotropic quad, additive blend), not the old guessed placement.
- Done:
  - `tools/pakprobe`: `params` now merges every scalar-parameter run in the MI
    instead of only the longest one (Fade, Raze and others had their flipbook
    block in a second run); `csv` also emits `Flipbook Speed` and
    `Procedural Animations Addive Blending`.
  - Extracted, for all 30 Bloomline cards, the `_L`/`_AM_Large` card texture plus
    the flipbook sheet from the local VALORANT install.
  - Composed each cell with `W = 268/(Scale*Ratio)`, `H = 640/Scale`,
    `cx = PosH*268`, `cy = (1-PosV)*640`, bilinear cell->card transform, additive
    blend `base + rgb*alpha*blend`, clipped to the card.
  - Wrote 30 APNGs to `official playercards/AgentMastery/Animated/` at 268x640,
    206 ms/frame (515 ms for Miks, whose `Flipbook Speed` is 0.5) and
    `manifest.csv` with every card's grid, quad and size.
  - Killjoy is the one card whose authored `PosV = 1.35` puts the quad fully
    above the card (a clamped colour wash, no animation). Its quad is clamped to
    the top edge (centre y = 0); the result matches the wiki capture's dome glow.
- Verified:
  - Pipeline reproduces the shipped Deadlock card: frame 0 vs the previous APNG
    mean abs error 0.20 (max 24 of 255) with the same quad and blend.
  - 30/30 files 268x640, valid `acTL`; frames 16/10/55 per card (Chamber's two
    identical frames merged by the APNG encoder with 2x duration); Killjoy 16.
  - Frame 0 vs mid-frame differs on every card; 30-card contact sheet plus
    6 full-size cards inspected against the static art.
  - `git status`: only `progress.md` modified; assets and `tools/` stay ignored.
- Next: none. Per-card nudges only if Yassine flags a specific agent.

### 2026-11-05 - Manual placement tuner for the 30 animated cards

- Goal: stop guessing overlay positions; give Yassine an HTML tuner where each
  card is moved/scaled by hand and saved straight into `Animated/`.
- Done:
  - `tools/cards/tuner/index.html`: 30-card grid, each tile has a live preview
    canvas, X/Y/W/H/rotation/blend controls, drag-to-move, wheel-to-scale,
    reset, and its own Save button.
  - `tools/cards/tuner/server.py`: local server on 127.0.0.1:8787 that serves
    `_tuner/src` (base art + flipbook sheet), composes the adjusted frames with
    the same additive blend, and atomically writes the APNG into
    `official playercards/AgentMastery/Animated/`. Saved values persist in
    `_tuner/placement.json`.
  - Save keeps `disposal=0` so file sizes stay near the previous APNGs
    (Hush 4.52 MB vs 4.41 MB before).
- Verified:
  - `python -m py_compile tools/cards/tuner/server.py`; HTML script passes
    `node --check`.
  - `GET /api/cards` returns 30 cards; `/` and `/tuner-src/Deadlock/base.png`
    return 200.
  - `POST /api/save` on Deadlock returned 16 frames / 268x640 / 206 ms; the
    original file was restored afterwards (SHA-256 unchanged) and the test
    `placement.json` removed.
  - Composer reproduces the shipped Deadlock frame 0: mean abs error 0.18.
  - Hush composes all 55 frames at 268x640 / 206 ms; output 4.52 MB.
- Next: start `python tools/cards/tuner/server.py` and tune per card; Save
  overwrites that card's APNG in `Animated/`.

### 2026-11-05 - Tuner: faster playback, stronger overlay

- Goal: fix the two problems Yassine hit in the tuner: animation far too slow
  and the animated layer barely visible.
- Cause (speed): `tick()` compared a frame index based on
  `performance.now() - started`, while `draw()` set `lastFrame` from raw
  `performance.now()`. The two clocks never agreed, so every visible card
  redrew at ~60 fps even though the frame index only changed every 206 ms.
  30 full-size canvases at 60 fps starved the browser.
- Fix:
  - One frame clock: `tick()` computes the frame and passes it to `draw()`;
    `draw()` stores exactly that index. Redraws now happen only on a real frame
    change or a control edit.
  - Per-card `Speed` slider (0.25x–4x). Default is 3x, so 16-frame cards play
    at ~69 ms/frame instead of 206 ms; Miks 172 ms.
  - Per-card `Opacity` slider (0–400%). Default 200%, applied as a multiplier
    on the material blend (`effective = min(1, blend × opacity)`), both in the
    preview and in the saved APNG.
  - `server.py` persists `ms` and `opacity` in `placement.json`, uses `ms` as
    the APNG duration, and clamps the effective weight in `compose_frame`.
- Verified:
  - `py_compile` and `node --check` pass.
  - Astra saved placement re-composed at 69 ms/frame; frame 0 mean brightness
    103.1 → 115.9 (+12.8) versus the previous saved APNG.
  - Composer defaults: unsaved cards load at 3x speed / 200% opacity.
  - Rebuilt all 30 files with the new defaults, preserving the nine placements
    already saved (Astra, Breach, Brimstone, Chamber, Clove, Cypher, Harbor,
    Hush, Iso). All 30 are 268x640 with a single duration: 69 ms (Miks 172 ms).
  - `manifest.csv` refreshed with the actual ms, opacity, quad and file size.
- Next: reload the tuner page so the new Speed/Opacity controls appear.

### 2026-11-05 - Tuner: import sheet colours, full-card Hush/Sova

- Goal: stop recolouring the flipbook; some cards (Hush) were visibly wrong.
- Cause:
  - The compositor blended additively (`base + rgb × alpha × weight`), which
    shifted every animation's colour.
  - Hush (and Sova) flipbook cells are fully opaque full-card frames, not
    effect layers. Drawing them additively over the base produced a ghosted
    doubled card.
- Fix:
  - `compose_frame` now imports the cell with normal alpha-over; the sheet's
    own RGB is preserved. No additive weight, no `blend` in the output.
  - `is_full_card()` detects fully opaque sheets and gives them a 268×640
    default quad, so they are drawn as the whole card instead of an overlay.
    Hush and Sova are the two full-card cards.
  - Opacity is now 0–100% (default 100%). Saved 200/400% values and the old
    Hush placement were normalised away.
  - Preview canvas uses `source-over` and shows a `full card` badge for those
    two cards.
- Verified:
  - `py_compile` and `node --check` pass.
  - `GET /api/cards`: Hush/Sova `fullCard=true`, 268×640, opacity 1.0.
  - All 30 APNGs rebuilt at 268×640, 69 ms (Miks 172 ms), no bad durations.
  - Headless Electron: 30 cards render, Hush shows `11x5 · 55f · 69ms · full card`,
    Sova `5x2 · 10f · 69ms · full card`.
  - `manifest.csv` rewritten with `full` column, current quad and file size.
- Next: reload the tuner page.

### 2026-11-05 - Tuner: 3-column grid, Hush cover fit

- Goal: show three cards per row and remove Hush's vertical stretch.
- Cause: full-card cells were forced to 268×640. Hush's cell is 372×410, so
  that change squashed it horizontally and stretched it vertically.
- Fix:
  - Grid is now exactly three columns, capped at 1100 px and centred.
    Each card is about 357 px wide at the cap.
  - Full-card defaults now **cover** the card at the cell's own aspect ratio:
    `scale = max(268 / cellW, 640 / cellH)`, then the canvas crops the overflow.
    Hush becomes `581.8×640`; Sova `268×670`. No anisotropy.
  - Editing W keeps the cell aspect for full-card cards, so the scale slider
    stays uniform.
- Verified:
  - Headless Electron computed `grid-template-columns` as three 357 px tracks.
  - `GET /api/cards`: Hush quad `581.819×640`, Sova `268×670`.
  - Hush APNG rebuilt: 268×640, 55 frames, 69 ms, 11.14 MB.
  - Sova APNG rebuilt: 268×640, 10 frames, 69 ms, 2.49 MB.
  - `manifest.csv` refreshed with the cover quads.
- Next: push the tuner HTML and APNGs.

### 2026-11-05 - Tuner: undistorted Hush/Gekko/Sova, track the shipped cards

- Goal: Hush looked stretched; put the sheet on the card as-is. Same for Gekko
  and Sova. Also keep the whole `official playercards/AgentMastery` folder in
  git and ignore only the tuner's working sources.
- Cause: the material quads are anisotropic. Hush 254.5x328.2 (1.17x),
  Gekko 226.7x433.0 (1.90x), Sova 269.6x430.1 (1.57x) against cells of
  372x410, 256x256 and 410x1024. The previous Hush/Sova "cover" default was
  undistorted but cropped most of the frame.
- Fix:
  - `server.py`: `FULL_ART = {Gekko, Hush, Sova}` (Gekko's transparent surround
    defeats the opacity test) and `TOP_SLICE = {Hush}`. Hush is fitted to the
    card width at its own aspect and pinned to the top edge; Gekko/Sova cover
    the card at their own aspect.
  - Rebuilt the three APNGs and saved their placements in `placement.json`.
  - `.gitignore`: only `official playercards/AgentMastery/_tuner/` is ignored;
    `Animated/`, `manifest.csv` and `preview_all.html` are tracked.
  - `manifest.csv` regenerated from the live placements.
- Verified:
  - `py_compile` on `server.py` + `prepare.py` passes.
  - 30 APNGs are 268x640 and multi-frame; every frame-0 composition matches its
    saved placement (mean abs diff < 3).
  - Quads keep the cell aspect: Hush 268x294.8 (0.909), Gekko 640x640 (1.0),
    Sova 268x670 (0.4). Hush APNG 11.68 MB -> 6.44 MB.
- Next: reload the tuner; push.

### 2026-11-05 — tuner: stretch, crop, wheel on number fields
- Goal: split W/H (stretch), add a source crop, drop the canvas wheel zoom,
  make the numeric fields wheel-adjustable.
- Done:
  - server.py: crop_cell() trims each sheet cell by cropL/R/T/B
    (percent per side, clamped 0-45, >=1px kept) before the resize;
    clean_placement() validates and defaults the four keys to 0.
  - index.html: W no longer rewrites H; Crop row (L/R/T/B) added; draw()
    crops the same source rect; Save sends the crop values; Reset zeroes them.
    Canvas wheel zoom removed; every numeric field adjusts on wheel
    (Shift = fine, Alt = coarse).
- Verified:
  - py_compile passes, embedded JS passes node --check.
  - POST /api/save with cropT/B=3 changed the Hush APNG (6,458,666 B), then
    re-saved with crop 0 back to 6,444,445 B (55 frames, 268x640, 69 ms).
- Next: tune cards in the browser at http://127.0.0.1:8787/.

### 2026-11-05 — tuner: mouse stretch and crop grips
- Goal: scale and crop the animation with the mouse instead of only fields.
- Done:
  - Pushed 8eac8d0 (To-DO split) and 279fff2 (stretch/crop fields) to origin/main.
  - index.html: 8 grips on the quad edges, clamped inside the card so quads
    larger than the card (Gekko 640) keep their grips on the card border.
    Body drag moves, grip drag stretches both axes freely (Shift keeps the
    start ratio), Alt or the "crop drag" toggle trims the source while the
    art keeps its size and position.
  - Cursor changes per grip; handles are drawn every frame.
- Verified:
  - node --check on the embedded script passes.
  - 16/16 numeric checks of the grip math: opposite edge/corner anchored,
    ratio lock, crop keeps the art in place, 0-45 clamp, 15px accumulated
    crop, 640px quad resize.
- Next: try it in the browser, then commit the .html.
### 2026-11-05 - card speed set to the tuner default; Miks at its wiki speed

- Goal: ship all 30 mastered APNGs at the default playback speed and make Miks
  match its reference capture.
- Done:
  - Rebuilt all 30 APNGs from placement.json at 69 ms/frame (the tuner's
    default 3x). Miks is 125 ms/frame: the wiki capture of its card loops every
    2.00 s (period found by frame autocorrelation: 58-59 frames of a 10 s,
    291-frame GIF) over the 16-frame flipbook.
  - placement.json and manifest.csv carry the new ms values; placements
    themselves (Gekko/Hush/Sova fixes) are unchanged.
- Verified: 30/30 files 268x640, frame counts unchanged (16/10/55), exactly one
  constant frame duration per file (69 ms, Miks 125); 29 files byte-identical to
  before, only Miks changed.
- Next: none.

### 2026-11-05 — Add Account: "Stay signed in:" under the image, premium step icons

- Goal: put the instructions directly under the sign-in picture as a
  "Stay signed in:" caption, and replace the two step badges with better icons.
- Done:
  - `AddAccountModal`: the old hint below the steps is gone. Under the image sits
    a caption row (red rounded tick + `Stay signed in:` in caps) and one line:
    "Tick it before you finish the login. The account is saved automatically."
  - `.aa-step-ico` is now a 22px gradient squircle with an inset highlight and
    an outer halo. Active = red gradient + breathing halo; done = emerald
    gradient + glow; idle = neutral glass.
  - Step 1 uses a conic-gradient spinner ring (`aa-orb`) that turns into a
    self-drawing check. Step 2 replaces the lucide `Ear` with a custom radar
    icon plus an expanding ping ring while listening.
- Verified: `tsc -p tsconfig.web.json` clean, ESLint clean on the component,
  `npm run build` OK; headless Chromium render of the real built CSS + markup
  checked in both the "opening" and "client ready" states.
- Follow-up: added a red arrow drawn over the screenshot (`aa-signin-figure` +
  inline SVG, viewBox 348x442) that curves from the bottom-right up to the
  "Stay signed in" row. `clip-path` keeps the glow inside the card's rounded
  corners.
- Follow-up 2: the arrow now plays on a 3 s loop — line draws 0→0.66 s, head
  pops at 0.84 s, both hold, fade out at 2.7 s, restart.
- Verified (follow-up): rebuild + tsc + ESLint clean; headless render shows the
  arrow tip landing on the "Stay signed in" label.
- Pushed to `origin/main`.
- Next: look at it once in the running app.

### 2026-11-05 — New profiles start with a random animated card; picker opens on Animated

- Goal: a fresh profile should get a random animated playercard right away, and
  the Customize picker should show animated cards first, normal ones second.
- Done:
  - `animated_cards.py`: reads `RIOTSWITCHER_ANIMATED_CARDS_DIR`, lists the
    installed APNGs as `card://animated/<file>` URLs, picks one at random.
  - `python-bridge.ts` passes `animatedCardDir()` to the backend through that
    env var, so the same folder works in dev and in the packaged build.
  - `main.py`: `_seed_random_animated_card` writes a random animated card into
    a newly created profile before the tracker refresh. Wired into
    `create_profile`, `capture_current_account`, and detection's
    `_on_profile_created`. Existing cards are never replaced.
  - `PlayerCardPicker`: tab order is Animated then Normal, and the default
    category is Animated.
- Verified: `pytest` 132 passed (incl. 4 new `test_animated_cards.py`),
  `vitest` 32 passed, `ruff` clean, `compileall` clean, `npm run build` OK;
  the picker's 5 tests pass.
- Known pre-existing failures (untouched files): `npm run typecheck` fails in
  `src/main/window.singleton.test.ts` (missing `openSettingsWindow` /
  `openAgentMapWindow` exports), `npm run lint` fails in `ProfileGrid.tsx` and
  `SettingsView.tsx`, and `npm run test` fails in `window.singleton.test.ts`.
- Next: run the app and confirm a new account shows an animated card and the
  picker lands on the Animated tab.

### 2026-11-05 — Interface sounds toggle in Settings

- Goal: TO-DO "add SFX on/off setting" — `lib/sfx.ts` already had
  `setEnabled`/`isEnabled` and `localStorage rs_sfx`, but nothing in the UI
  touched it.
- Done:
  - `SettingsView`: new "Interface sounds" `SettingToggle` in the System card,
    seeded from `sfx.isEnabled()`. Toggling calls `sfx.setEnabled` (persists to
    `rs_sfx`) and plays one tick when switching on.
  - System blurb now reads "Tray behaviour, sounds and language."
  - Added a test in `SettingsView.test.tsx` asserting the switch flips
    `aria-checked` and writes the matching `rs_sfx` value.
  - Ticked the item in `TO-DO.md`.
- Verified: `vitest` on `SettingsView.test.tsx` 9/9 passed, `tsc -p
  tsconfig.web.json` clean, `npm run build` OK. ESLint still reports the
  pre-existing `react-hooks/purity` error at `SettingsView.tsx` `Date.now()`
  (present at HEAD, untouched).
- Next: none.

### 2026-11-05 — TO-DO sweep: lazy card art, drag guard, highlighted Riot Client, env example, log cap

- Goal: clear the small open items in `TO-DO.md`; tick the ones already built.
- Done:
  - `ProfileCard`: card art uses `loading="lazy"` + `decoding="async"` so only
    cards near the viewport fetch from valorant-api.com (top to bottom), with
    a shimmering `.lobby-art-charge` placeholder until `onLoad`. Charge state
    resets when a profile's card changes.
  - `index.css`: `img { -webkit-user-drag: none; }` so Chromium never starts an
    OS drag of card art / rank emblem / agent icon onto the desktop.
  - `AddAccountModal`: "Riot Client" in both the opening and ready steps is
    wrapped in `.aa-accent` (riot red, bold).
  - `.env.example` with the single supported key, `HENRIKDEV_API_KEY`.
  - `main/index.ts`: `electron-log` file transport capped at 5 MB; electron-log
    rotates to `main.old.log` after that.
  - Ticked finished items: SFX toggle, card skeleton, card scaling, drag guard,
    highlighted Riot Client, Stay-signed-in image, `.env.example`, log cap,
    auto-updater, launch-product setting, tray-close settings.
- Verified: `pytest` 132 passed; `vitest` 33 passed with the known
  `window.singleton.test.ts` failures (the test targets `openSettingsWindow` /
  `openAgentMapWindow`, which no longer exist now that Settings is an overlay);
  `tsc -p tsconfig.web.json` clean; `npm run build` OK; ESLint only the known
  `react-hooks/purity` error in `SettingsView.tsx`.
- Next: the stale `window.singleton.test.ts` needs a decision (delete or
  rewrite for the overlay UI) before `typecheck`/`test` can go green.



### 2026-11-05 — Playercard change stayed invisible; export scope + passkey copy

- Goal: fix "I change the playercard and the new one never shows", add a copy
  button to the export passkey, and allow exporting all or selected accounts.
- Root cause: `ProfileCard` reset `artReady` in an effect keyed on the card URL.
  A selected card is already cached by the picker grid, so `load` could fire
  during commit, the effect then set the flag back to false, and no second
  `load` came — `.lobby-art.is-charging { opacity: 0 }` hid the art for good.
- Done:
  - `ProfileCard`: readiness is now "which URL finished loading" (`loadedSrc`)
    instead of a boolean, so it cannot be clobbered. The effect for a new URL
    also clears a previous `display: none` left by a failed image.
  - `profile_manager.export_profiles(passkey, names=None)`: optional name
    filter, stored order kept; empty or unknown selection raises.
  - `main.py` forwards `names`; both export UIs (`ImportExportModal`,
    Settings > Backup) now offer All profiles / Select accounts with a
    checkbox list, select-all/clear, and a passkey copy button.
- Verified: new `ProfileCard.test.tsx` 3/3, `ImportExportModal.test.tsx` 4/4;
  `vitest` 41 passed (remaining 10 failures are the known stale
  `window.singleton.test.ts`); `pytest` 136 passed; `ruff` clean;
  `tsc -p tsconfig.web.json` clean; `npm run build` OK; ESLint only the
  pre-existing `react-hooks/purity` error in `SettingsView.tsx`.
- Next: tick the export item in `To-DO.md` once its uncommitted edits are
  resolved; confirm in the running app that a newly picked card appears.

### 2026-11-05 — Dummy accounts for Immortal 1 / 3 and Radiant

- Goal: more layout-test profiles, covering every high tier.
- Done:
  - Stopped the running dev app (electron-vite node + electron + Python
    backend) because the backend holds the profile list in memory and would
    overwrite the file.
  - Appended three profiles to `data/profiles_data.json`:
    `Dummy Immortal 1#TEST` (tier 24, Reyna), `Dummy Immortal 3#TEST`
    (tier 26, Sage), `Dummy Radiant#TEST` (tier 27, Neon). Each has RR,
    W/L, peak rank, tier icon and an animated mastery card.
  - Immortal 2 already existed as `Dummy Immortal#TEST` (tier 25).
  - Backup of the previous file: `data/profiles_data.json.bak-20261105-141056`.
  - Relaunched `npm run dev`; backend reports `ready, data_dir=...\data`.
- Verified: `ProfileManager` loads 9 profiles and lists all six dummies;
  JSON ends cleanly with no BOM; app booted without backend errors.
- Next: check the six cards in the lobby; Immortal 3 gets the tier-18+ sweep
  and Radiant the radiant styling.

### 2026-11-05 — Remove the spinning rank sweep

- Goal: no rotating conic ring on rank emblems (it was red on Immortal).
- Done: removed the `rank-sweep` span, the `has-sweep` / `is-radiant`
  modifiers and their CSS from `ProfileCard` / `card-glow.css`. The
  `rank-spin` keyframes stay because the START button's launching icon uses
  them; they are now commented as such.
- Verified: `tsc -p tsconfig.web.json` exit 0, ESLint clean on the component,
  `vitest` 41 passed (10 known `window.singleton` failures), HMR applied with
  no errors in the dev log.
- Next: none.

### 2026-11-05 — Radiant rank tint: white-gold

- Goal: keep Immortal's red glow, give Radiant a white/gold glow.
- Done: `rankColor(27)` in `lib/ranks.ts` changed from `#ff4655` to
  `#ffe9b0`; tiers 24-26 stay `#ff5f7a`. The tint feeds the halo, the
  breathing glow and the hover ping.
- Verified: new `lib/ranks.test.ts` 3/3, `tsc -p tsconfig.web.json` exit 0,
  dev app hot-reloaded.
- Next: none.

### 2026-11-05 — Drag-and-drop: lost pointerup left cards undraggable

- Goal: dragging sometimes died and the card landed in the first slot.
- Root cause: the engine listens for `pointerup` on `window`. Releasing the
  button outside the window (or alt-tabbing) meant no `pointerup`; the drag
  stayed active, `body.is-sorting` set `pointer-events: none` on every other
  card (so nothing else could be picked up), and the stuck card kept chasing
  the cursor until the nearest slot — usually slot 0 — was committed.
- Done in `lib/sortable.ts`:
  - `setPointerCapture` on lift, released on finish, so `pointerup` arrives
    even outside the window.
  - `pointermove` with `buttons === 0` ends an active drag / drops a pending
    press; `pointercancel` now cancels instead of committing; window `blur`
    cancels.
  - A new `pointerdown` clears any stale drag first.
  - Hit-testing uses the card's physical slot (geometry) for the
    current-slot comparison instead of `order.indexOf`, and ignores fully
    degenerate layouts (all slots at 0,0) instead of collapsing to slot 0.
- Verified: new `lib/sortable.test.ts` 4/4 (lost button, blur, stale press,
  capture/release); `vitest` 48 passed (10 known `window.singleton` failures);
  `tsc -p tsconfig.web.json` exit 0; ESLint clean; dev app hot-reloaded.
- Next: check a real drag released over the desktop and after Alt+Tab.

### 2026-11-05 — Remove Appear Offline feature

- Goal: drop the Deceive-style presence-masking stack from the app.
- Done: deleted `src/backend/deceive/` (config/chat proxies, XMPP filter,
  crypto helper, presence manager/constants); removed the `presence_*` IPC
  handlers, `PresenceManager` wiring and `set_launch_args_provider` from
  `main.py` / `riot_client.py`; `LaunchOrchestrator` lost its `presence`
  parameter and start step; `AppearOffline` removed from the config defaults;
  the Settings "Privacy" card and its `EyeOff` import are gone; docs
  (`README`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `ruff.toml`) updated.
- Verified: 136 pytest pass; Ruff clean; compileall clean; `npm run build`
  exit 0; `main`, `launch_orchestrator`, `riot_client`, `config_manager`
  import clean; no `presence`/`deceive`/`AppearOffline` left in `src/backend`.
  Pre-existing and unrelated: 10 `window.singleton` Vitest failures and
  matching typecheck errors, plus ESLint errors in `ProfileGrid.tsx` and
  `SettingsView.tsx:234`.
- Next: none. `plans/electron-rewrite.md` kept as a historical record.

### 2026-11-05 - Drag-and-drop: second reorder broke the grid

- Goal: dragging worked once, then the second drag misbehaved/stuck.
- Root cause: the stable ref callbacks in `ProfileGrid` deleted their own cache
  entry when React detached them (`if (!el) refCache.current.delete(name)`).
  That made the next render hand React a brand-new callback for every card, so
  React detached/re-attached all refs, `register()` rebuilt every `Body`
  (idle, not lifted) and the dragged card's spring state was lost. Its drop
  animation never ran again, leaving `is-lifted` + a stale transform forever;
  every later reorder repeated the churn.
- Done:
  - `ProfileGrid`: ref callbacks are cached for the component's lifetime and
    never pruned.
  - `sortable.register`: when a card's element is replaced, the spring/lift
    state moves to the new node and the old node is cleaned; unregistering a
    lifted element clears its chrome and cancels the drag quietly.
  - `tick`: a `lifted` body is always animated, so its drop can finish even
    if the body was flagged idle.
  - Two regression tests in `lib/sortable.test.ts` (state transfer on element
    replacement, chrome cleanup on unregister).
- Verified: reproduced the stuck `scale(1.045)`/`is-lifted` card in the live
  app over CDP, then three consecutive drags (left->right, right->left,
  third->second) each settled with no lifted leftovers; `tsc` web 0,
  `vitest` 50 passed + 10 known `window.singleton` failures, ESLint clean on
  the changed engine/test files.
- Next: none. Note: the concurrent `d4c7aef` commit captured the temporary
  CDP hook in `src/main/index.ts`; its removal is in the working tree.


### 2026-11-05 - TO-DO sweep: map stats, shortcuts, support, exit fix

- Goal: finish the unchecked TO-DO items (the commented launch-animation line
  stays skipped) and remove the leftover tool/asset files.
- Done:
  - Agent Map: summary strip (maps, games, overall winrate, best map), map/
    agent search, and sorting by most played / best winrate / name; agent rows
    sort by games then winrate.
  - Desktop shortcuts: `src/main/shortcuts.ts` builds a Windows `.lnk` named
    `RiotSwitcher - <profile>.lnk` that starts the app with `--profile <name>`.
    The picker has a "Desktop shortcut" button; startup and second-instance
    argv both launch the requested profile once the backend is ready.
  - Support: Settings has a "Support the Project" card that opens
    https://github.com/sponsors/yassine808 through a validated https IPC call.
  - Exit: tray Exit and every `before-quit` path call `permitClose()` before
    `app.quit()`, so close-to-tray can no longer swallow the quit.
  - Tests: replaced the stale `window.singleton.test.ts` (it targeted removed
    multi-window functions) with `window.test.ts` covering close-to-tray,
    permitClose/requestClose, minimize-to-tray and the 1210 px width cap; added
    `shortcuts.test.ts` and `tests/test_running_profile.py`; the export
    round-trip test now asserts the saved playercard survives.
  - New `AgentMapView.test.tsx` covers the summary, search and sort.
  - TO-DO boxes ticked; `Stay-signed-in.png`, `tools/` and the tuner assets were
    already gone from disk and are now removed from the index (commit 9e8100d).
- Verified: `vitest` 68 passed; `pytest` 148 passed; `npm run typecheck` clean;
  `npm run build` exit 0; Ruff and compileall clean; ESLint clean on every file
  touched here (the pre-existing ProfileGrid `react-hooks/refs` and
  SettingsView `react-hooks/purity` errors remain).
- Next: click the new shortcut and the Agent Map controls once in a running app.
  Note: an external auto-commit (`9e8100d "2"`) captured the in-progress edits
  mid-task; the remaining working-tree diff is the TO-DO ticks, the shortcut
  sanitizer fix, and the new/replaced window/shortcut tests.

### 2026-11-06 — Portable launch fix, new icons, encrypted session backups

- Goal: portable exe looked like it never started; adopt the new icon set
  everywhere; keep the saved Riot session tokens unreadable outside the app;
  confirm data survives no matter where the exe is launched from.
- Done:
  - `window.ts`: the window is revealed by `ready-to-show`, by a 5 s fallback
    timer, or right after the load settles — a stalled renderer can no longer
    leave an invisible window holding the single-instance lock. Load errors are
    logged instead of aborting start-up. `index.ts` logs unhandled rejections
    and a second launch shows any surviving window when `appWindow` is still
    null.
  - Icons: `build/icon.ico` + `build/icon.png` and the renderer `favicon.*` /
    `icon-512.png` come from the new artwork; the title-bar mark is the same
    new logo with the red glow removed.
  - `secure_store.py` (new): DPAPI (`CryptProtectData`, current-user scope +
    app entropy) seals the session backups; a tar stream for directory backups,
    one blob per file, magic header `RSENC1`. Legacy plaintext backups still
    restore. Non-Windows hosts use a 0600 Fernet key (dev/CI only).
  - `session_manager.py` seals on save and decrypts on restore; tar members are
    path-validated before extraction.
- Verified: `pytest` 148 passed (the dir-session test now asserts the sealed
  blob and a working restore), Ruff and compileall clean, `vitest` 68 passed,
  `npm run typecheck` clean.
- Next: publish the rebuilt installer + portable.

### 2026-11-06 — VALORANT is never closed (and the test suite was closing it)

- Goal: the app must never terminate Riot Client or VALORANT, and a test run
  must never do it either.
- Found: `tests/test_account_capture.py` drove `orchestrator.switch_to()`, which
  called the real `riot_processes.kill_all()` -> `taskkill /F /T /IM
  VALORANT.exe`. Every `pytest` run force-closed the running game and Riot
  Client. `orchestrator.stop()` and `riot_client.stop_and_wait()` also used
  `kill_all`, despite the latter being the "stop_riot_client" path.
- Done:
  - `tests/conftest.py`: autouse fixture disarms `riot_processes.kill_all` and
    both wait helpers for the whole suite; `is_running` stays real (read-only).
  - `launch_orchestrator._kill_riot_processes()`: refuses with "Close VALORANT
    before switching accounts" while the game is running, otherwise stops the
    Riot Client only. `kill_all_and_wait()` (Add Account) is client-only too.
  - `tests/test_shutdown_safety.py` now covers: shutdown/client-only stop, stop
    job, switch-when-idle, and the refusal when VALORANT is running.
  - Bumped to 3.1.1 for the rebuilt artifacts.
- Verified: `pytest` 154 passed with the VALORANT/RiotClientServices PIDs
  identical before and after the run; ruff and compileall clean.
- Next: publish v3.1.1 and verify the exe icons + 30 bundled cards.
### 2026-11-06 � Exit safety, ProgramData storage, backup option removed

- Goal: closing the app must leave VALORANT and the Riot Client running; saved
  sessions stay encrypted in one fixed machine-wide folder; the Import/Export
  backup option is gone; the exe still ships all 30 animated cards and the
  clean (non-red) icon.
- Done:
  - `main.py`: data directory is now `C:\ProgramData\RiotSwitcher` (override
    `RIOTSWITCHER_DATA_DIR`, dev still `./data`). First packaged start moves
    `profiles`, `profiles_data.json`, `configs.json`, `playercards.db`,
    `agents.enc`, `shared` and `local.key` from `%APPDATA%\RiotSwitcher` and
    deletes the old copy, so no second token copy remains. Target files are
    never overwritten. `icacls` limits the folder to the current user, SYSTEM
    and Administrators.
  - Exit path already stopped only the Python threads; removed the remaining
    `close_all` and `kill_riot_processes` IPC handlers plus the unused
    `kill_valorant` / `close_valorant_then_client` helpers. A switch still
    stops and restarts the Riot Client only, and refuses while VALORANT runs.
  - Removed `ImportExportModal`, `utils/base64`, their tests, the HomeView
    button/modal, the Settings > Backup card and its handlers, and the
    `export_profiles` / `import_profiles` backend handlers. `ProfileManager`'s
    dormant round-trip methods and tests were left untouched.
  - README, AGENTS, ARCHITECTURE and progress updated for the new path, DPAPI
    sessions and the removed backup feature.
- Verified:
  - `npm run typecheck` clean.
  - `npm run test`: 12 files, 48 tests passed.
  - `python -m pytest tests/ -q`: 160 passed.
  - Ruff and compileall clean.
  - `npm run build` and `npm run dist` succeeded (version 3.1.1).
  - `release\win-unpacked\resources\playercards\animated`: 30 APNGs; the
    portable `app-64.7z` also contains 30 APNGs and `resources\python\main.exe`.
  - `build/icon.ico`, `build/icon.png`, `favicon.ico`, `favicon.png` and
    `icon-512.png` contain 0 reddish pixels.
  - `npm run lint` still reports the pre-existing `ProfileGrid` ref-during-
    render and `SettingsView` `Date.now` purity errors; no new lint error came
    from this change.
  - After the full test runs, VALORANT (23540), VALORANT-Win64-Shipping
    (7164) and RiotClientServices (25168) were still running with their
    original start times.
- Next: install the rebuilt 3.1.1 artifacts and confirm the Windows icon cache
  no longer shows the old red-glow icon (the shipped assets are clean).

### 2026-11-06 — Free window width, chevron taskbar icon

- Goal: remove the maximum window-resize cap but keep the existing minimum;
  replace Electron's default atom taskbar icon with the supplied chevron icon.
- Done: dropped `maxWidth`/`MAX_WINDOW_WIDTH` from `window.ts`; `minWidth: 900`
  and `minHeight: 788` are unchanged. The window now passes
  `build/icon.png` as its `icon`, and `index.ts` calls
  `app.setAppUserModelId("com.riotswitcher.app")` on Windows so the taskbar
  button uses the RiotSwitcher identity instead of Electron's default.
- Verified: `npm run typecheck` clean; `vitest` 49 passed (including new
  window options + icon assertions); the existing 12 ESLint errors are
  unchanged and pre-date this task.
- Next: rebuild the installer and portable, then confirm the taskbar icon in a
  running dev window.

### 2026-11-06 — Four cards at minimum width; version moved to Settings

- Goal: at the minimum window size show four profile cards per row instead of
  three, and move the version label out of the title bar into Settings.
- Done: `MIN_WINDOW_WIDTH = 1060` in `window.ts` (four cards at the default
  1.17 scale need ~1038px of content plus the Windows resize border); the
  minimum height stays 788 and the width above the floor stays free.
  `TitleBar.tsx` no longer fetches or renders the version. Settings > Updates
  now shows an "Installed version" row, read from the same `getVersion` bridge.
- Verified: `npm run typecheck` clean; window + Settings tests 8 passed;
  the restarted dev window reports 1116×798 outer at its default 1100×790.
- Next: rebuild installer + portable with the final window and version changes.

### 2026-11-06 — Equal picker tiles and charging skeletons

- Goal: normal playercards must use the same picker tile size as animated
  cards, and both categories need a smooth skeleton charge while loading.
- Done: both catalogues serve 268×640 art, so `PlayerCardPicker` now uses one
  `aspect-[67/160]` tile for every category instead of `3/4` for normal cards.
  The initial catalogue load renders eight charging tiles instead of a spinner,
  and each individual image keeps a shimmer overlay until its `onLoad` fires.
  The shimmer is a CSS gradient animation and is disabled under
  `prefers-reduced-motion`.
- Verified: picker suite 8 passed (new tile-size, skeleton-grid and per-image
  skeleton tests); `npm run typecheck` clean.
- Next: final installer + portable build, then check the sealed env and 30
  animated APNGs inside both artifacts.

### 2026-11-06 - Background pause, CI gates, final 3.1.1 artifacts

- Goal: stop every animation when RiotSwitcher is backgrounded/unfocused
  (including while a fullscreen game has focus), keep the beams scene stable
  across resize, add project CI checks plus an API-key leak gate, and ship
  rebuilt installer + portable artifacts.
- Done:
  - `useAppActive` defines active as `visibilityState === "visible"` and
    `document.hasFocus()`; `AppActiveProvider` toggles `html.app-inactive`.
    CSS pauses every animation timeline, `ProfileCard` and
    `PlayerCardPicker` swap APNG `src` for a transparent GIF while inactive,
    and the beams canvas stops its RAF and preserves beam positions on resize.
  - `PlayerCardPicker` uses one `aspect-[67/160]` tile for normal and animated
    cards, renders eight shimmer tiles during the initial load, and keeps a
    per-image shimmer until `onLoad`.
  - `ProfileGrid` renders DOM order from state (no ref reads during render)
    and uses a `SortableItem` child with a stable ref callback.
    `SettingsView` replaces `Date.now()` scroll locking with a timer.
  - Added `scripts/check-api-leaks.mjs` + `npm run check:api-leaks`: scans
    tracked text, checks `.env` / sealed artifacts are absent from current
    tree and full history, catches provider key patterns, rejects exact `.env`
    values, and keeps the env bridge out of `src/renderer`.
  - CI adds an `api-leak` job (full-history checkout) and includes it in
    `build.needs`; build now rejects API-key bridge symbols in
    `out/renderer` and asserts exactly 30 Agent Mastery APNGs.
- Verified:
  - `npm run lint`: 0 errors (2 Fast Refresh warnings).
  - `npm run typecheck`: clean.
  - `npm run test`: 13 files, 54 tests passed.
  - `python -m pytest tests/ -q`: 160 passed.
  - `npm run check:api-leaks`: clean; 182 tracked files and 1 local `.env`
    value checked; no tracked or historical `.env`/sealed artifacts.
  - `npm run dist` succeeded for 3.1.1. `release\win-unpacked\resources`
    contains `env.bin` (109 bytes), `python\main.exe`, and 30 APNGs. Both
    `RiotSwitcher Setup 3.1.1.exe` and
    `RiotSwitcher-3.1.1-portable.exe` contain `resources\env.bin`,
    `resources\python\main.exe`, and all 30 APNGs.
  - The sealed blob decrypts to `HENRIKDEV_API_KEY` (41 chars); its shard is
    present only in `out\main\index.js`, and no key plaintext or shard exists
    anywhere under `out\renderer`.
- Next: Yassine installs/tests both artifacts; commit and push only after his
  approval.

### 2026-11-06 — Sonar pass: broken namespace refactor, lint warnings, test wiring

- Goal: scan the current `sonarcube` branch, fix every reported issue, and push
  the clean result.
- Found:
  - `main.py` called `SimpleNamespace` without importing it; the backend could
    not start, and Ruff reported two `F821` errors.
  - `tests/test_account_capture.py` still called the old positional
    `_build_handlers(...)` signature; 2 pytest failures.
  - Two `react-refresh/only-export-components` ESLint warnings from `Toast.tsx`
    and `useAppActive.tsx`.
- Done:
  - Added `from types import SimpleNamespace`.
  - Rewrote the handler-wiring test to build the same `ctx` / `helpers`
    namespace the real entry point uses (no test assertions weakened).
  - Moved toast types, context and `useToast` to `lib/toast.ts`; moved the app
    active context and hook to `hooks/appActiveContext.ts`. Component files now
    export only components; consumers import the new modules.
- Verified:
  - `npm run lint`: 0 errors, 0 warnings.
  - `npm run typecheck`: clean.
  - `npm run test`: 13 files, 55 tests passed.
  - `python -m pytest tests/ -q`: 160 passed.
  - `python -m ruff check src/backend tests/`: clean.
  - `python -m compileall -q src/backend tests`: clean.
  - `node scripts/check-api-leaks.mjs`: clean.
  - `npm run build`: succeeded.
- Next: commit and push the branch.

### 2026-11-06 - Re-verify sonarcube branch and push pending edits

- Goal: re-scan the existing `sonarcube` branch, confirm zero issues, and push
  the two edits Yassine left in the working tree.
- Done:
  - Confirmed `HEAD` already equals `origin/sonarcube` at `52ba785`.
  - Re-ran the full gate; no code fixes were needed.
  - Staged `To-DO.md` (new VALORANT quit-confirmation note) and
    `package-lock.json` (version 3.0.0 -> 3.1.1, `engines` sync) by name.
- Verified:
  - `npm run lint`: 0 errors, 0 warnings.
  - `npm run typecheck`: clean.
  - `npm run test`: 13 files, 55 tests passed.
  - `npm run test:py`: 160 passed.
  - `python -m ruff check src/backend tests/`: clean.
  - `python -m compileall -q src/backend tests`: clean.
  - `npm run check:api-leaks`: clean.
  - `npm run build`: succeeded.
- Next: push the branch.
