# Code signing

Status: **not signed.** Every artifact in `release/` is built with
`CSC_IDENTITY_AUTO_DISCOVERY: "false"` (`.github/workflows/release.yml`), so the
installer and the portable exe carry no Authenticode signature. Windows shows
"Unknown publisher" and SmartScreen warns on first run (README says so).

This document is the plan to fix that with **SignPath Foundation**, the free
code-signing service for open-source projects, plus the false-positive
submission pack that signing alone does not replace.

| Item | Value |
| --- | --- |
| Signing service | SignPath.io, Foundation (free for OSS) |
| Certificate | Held by SignPath; the private key never reaches this repo |
| Cost | 0 |
| Approval | Application reviewed by SignPath, days to weeks |
| What it fixes | "Unknown publisher", SmartScreen publisher name, AV reputation over time |
| What it does not fix | Heuristic AV detections of the PyInstaller backend — see §4 |

---

## 1. Why a self-signed certificate is not the answer

A self-signed certificate is free and takes five minutes, and it is worse than
useless for this problem: SmartScreen treats an untrusted self-signed signature
exactly like no signature, and AV reputation systems ignore it. Only a
certificate chaining to a public CA that SmartScreen already trusts changes the
"Unknown publisher" line.

Paid options exist (Azure Trusted Signing ~$10/month with identity validation,
or an OV/EV certificate from a CA at $200–$500/year) but the OSS route through
SignPath Foundation is free and is what this plan uses.

---

## 2. SignPath Foundation application

Apply at <https://signpath.org/apply>. The form is short; the answers below are
written for this repository and can be pasted directly.

### 2.1 Project details

```text
Project name:      RiotSwitcher
Repository:        https://github.com/yassine808/assist
License:           GPL-3.0 (OSI-approved, full text in LICENSE)
Language:          TypeScript (Electron) + Python 3.9 backend
Platform:          Windows x64
Homepage:          https://github.com/yassine808/assist
Download page:     https://github.com/yassine808/assist/releases
Maintainer:        yassine808 <yassine808@users.noreply.github.com>
```

### 2.2 Description

```text
RiotSwitcher is a free, open-source Windows desktop app that switches between
Riot Games accounts by swapping the Riot Client session files on disk. It is a
convenience tool for players who own several accounts: no game memory, no
Vanguard, no game traffic is touched. Source is GPL-3.0 and the full publish
pipeline runs on GitHub Actions.

The project is distributed only as free downloads from GitHub Releases. There
is no paid tier, no adware, no bundled installer offers, no telemetry, and no
network service operated by the maintainer. The only third-party call is the
public HenrikDev VALORANT API for rank and match statistics.

We request free code signing because unsigned Electron installers trigger
SmartScreen's "Unknown publisher" warning for every user on every release, and
because Windows Defender heuristics flag the PyInstaller-packaged Python
backend on some machines. A trusted signature is the only fix for the first
problem, and it materially improves the second.
```

### 2.3 Build and release facts

```text
Build system:      GitHub Actions, windows-latest, tag-triggered
Workflow:          .github/workflows/release.yml (to be replaced by
                   .github/workflows/release-signed.yml)
Artifacts:         RiotSwitcher-Setup-<version>.exe (NSIS installer)
                   RiotSwitcher-<version>-portable.exe (self-extracting)
                   resources/python/main.exe (Python backend, one-folder)
Release cadence:   irregular, a few releases per month
Reproducible:      yes - every release is built from a tag by CI, never on a
                   developer machine
Signing policy:    one policy, "release-signing", manual approval per request
Artifact config:   PE files - **/*.exe
```

### 2.4 What SignPath gives back

After approval you receive:

- an **organization ID** for the SignPath organization;
- a **project slug** (`riotswitcher`);
- a **signing policy slug** (`release-signing`) and its artifact configuration;
- an **API token** you create in the SignPath UI.

Those four values map onto the secrets and variables used by
`.github/workflows/release-signed.yml`:

| Value | Where it goes | Kind |
| --- | --- | --- |
| API token | `SIGNPATH_API_TOKEN` | repository secret |
| Organization ID | `SIGNPATH_ORGANIZATION_ID` | repository variable |
| Project slug | `SIGNPATH_PROJECT_SLUG` | repository variable |
| Signing policy slug | `SIGNPATH_SIGNING_POLICY_SLUG` | repository variable |

Set them with:

```powershell
gh secret set SIGNPATH_API_TOKEN
gh variable set SIGNPATH_ORGANIZATION_ID --body "<org-id>"
gh variable set SIGNPATH_PROJECT_SLUG --body "riotswitcher"
gh variable set SIGNPATH_SIGNING_POLICY_SLUG --body "release-signing"
```

---

## 3. The signing pipeline

Signing a packaged Electron app is not one signature. Three files matter, and
two of them only exist *before* packaging:

```
build:py ──► release/python/main.exe ─────────┐
                                              ├─► sign pass 1 (inner)
npm run build ──► out/ ──► --dir ──► win-unpacked/RiotSwitcher.exe ─┘
                                              │
                                              ▼
                          --prepackaged ──► Setup.exe + portable.exe
                                              │
                                              ▼
                                          sign pass 2 (outer)
                                              │
                                              ▼
                                     publish GitHub release
```

**Pass 1 signs the binaries that end up inside the installer.** This is the pass
that matters for AV: `main.exe` is a PyInstaller-frozen Python executable, which
is the single most common false-positive shape on Windows, and
`RiotSwitcher.exe` is what the user actually launches after installing. Signing
them before packaging means the installed app carries a valid publisher.

**Pass 2 signs the installer and the portable exe.** This is what clears the
SmartScreen warning on download.

### 3.1 Known trade-off: blockmap after signing

`electron-updater` uses the `.blockmap` electron-builder writes during
packaging, which is a hash map of the *unsigned* installer bytes. Signing the
installer afterwards invalidates it, so differential updates fall back to a
full download. That is a bandwidth cost, not a failure: the updater verifies
the full file and installs it normally.

Two ways out, neither taken yet:

1. sign only pass 1 and leave the outer installer unsigned — no, that defeats
   the point;
2. recompute the blockmap after signing — `app-builder` has no public command
   for it, so this means reproducing electron-builder's blockmap format by
   hand. Not worth it for a 139 MB installer that updates a few times a month.

This is written down so nobody wastes an afternoon on "why is the update
downloading 139 MB every time" later.

---

## 4. False-positive pack (signing does not cover this)

A valid signature stops the "Unknown publisher" dialog and builds reputation
over time, but it does not automatically clear a heuristic detection of a
PyInstaller executable. This part is manual and must be repeated **per
release**, because submissions are keyed by file hash.

### 4.1 Per release

1. Build the release normally.
2. Submit both executables to Microsoft at
   <https://www.microsoft.com/en-us/wdsi/filesubmission>:
   - submission type: **Software developer**;
   - detection: **Incorrectly detected as malware**;
   - attach `RiotSwitcher-Setup-<version>.exe`, `RiotSwitcher-<version>-portable.exe`
     and `resources/python/main.exe` from `release/win-unpacked/`;
   - company: `RiotSwitcher Contributors`;
   - note: "Open-source GPL-3.0 Electron app, built by public GitHub Actions at
     <run URL>, source at <repo>. Backend is PyInstaller-frozen Python."
3. Check the hashes on VirusTotal after the release is public. Only a couple of
   minor engines should flag the PyInstaller backend; anything broader means a
   real detection to chase.

### 4.2 Reducing the signal itself

Cheap changes that measurably reduce heuristic hits, in order of impact:

| Change | Effect | Cost |
| --- | --- | --- |
| Sign `main.exe` (pass 1) | removes unsigned-binary heuristic | needs SignPath |
| Ship backend as one-folder, not one-file | no self-extracting stub at runtime | already done |
| Keep the installer free of bundled offers/telemetry | removes PUA heuristics | already done |
| Consistent publisher name across releases | builds reputation | needs a stable cert |

The current build already has the middle two. The first is the one this plan
unlocks.

---

## 5. Adopting the draft workflow

`.github/workflows/release-signed.yml` is written but **not wired to tags** on
purpose: `release.yml` still owns the `v*` trigger, and two workflows publishing
to the same release would race.

To switch over, in one commit:

1. `release-signed.yml`: replace the `workflow_dispatch` trigger with the same
   `push: tags: ["v*"]` trigger `release.yml` has.
2. `release.yml`: delete it, or reduce it to a build-only workflow with no
   publish step.
3. `README.md`: drop the "The builds are not code-signed" sentence at line 80.
4. Run one release by hand (`gh workflow run release-signed.yml -f tag=vX.Y.Z`)
   and confirm the publisher line before deleting the old workflow.

Nothing above was applied automatically — the current release path is
untouched.
