# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Assist — a VALORANT "extension launcher" (Avalonia 11 desktop app, `net7.0-windows`). It account-switches, shows store/dashboard/live-match data, and runs optional modules (Discord Rich Presence, dodge list). Riot's own client still does downloading, patching, and launching.

## Layout

- `Assist/` — the app (`Assist.sln`, `Assist.csproj`).
- `Assist.Shared/` — **git submodule** (`AssistTeam/Assist.Shared`) referenced as a ProjectReference. Editing it is a change to a separate repo; commit and push there too.
- `Assist/Library/*.dll` — vendored binaries with no source here: `Valnet.dll` (Riot auth + game APIs) and `AssistUser.Lib.dll` (Assist's own backend). Their behavior can only be inspected via decompilation.

## Commands

```bash
dotnet build Assist/Assist.sln -c Release --nologo   # what CI builds
dotnet format Assist/Assist.sln --verify-no-changes  # CI static check (non-blocking)
dotnet list Assist/Assist.sln package --vulnerable --include-transitive
Assist/bin/Release/net7.0-windows/Assist.exe         # run
```

There is no test project. Verification is: build, run the exe, read the log.

The build emits ~600 MVVM-toolkit warnings; they are pre-existing noise. Grep for `: error` when checking a build.

## Runtime state lives outside the repo

- Logs: `%AppData%\AssistData\Logs\Assist-<date>-<n>.txt` — **read these first for any startup/crash report**. Release builds write to file; Debug builds only write to an allocated console (`App.axaml.cs: CreateLogger`).
- Settings/accounts: `%AppData%\AssistData\` (`AssistSettings.json`, `Accounts\AccountSettings.json`, `Deps\curl\`).
- Installed copy (Velopack): `%LocalAppData%\Assist\`. Running an uninstalled dev build logs `Cannot perform this operation in an application which is not installed` from the update check — harmless.

## Architecture

**Static global app state.** `ViewModels/AssistApplication.cs` is a static class holding `ActiveUser` (RiotUser), `ActiveAccountProfile`, `AssistUser` (Assist account), `Server`, the Valorant websocket client, and token refresh service. It also owns window navigation (`ChangeMainWindowView`, `ChangeMainWindowPopupView`). There is no DI container in practice — assume anything reachable is a static singleton.

**Settings are static singletons too**: `AssistSettings.Default`, `AccountSettings.Default`, `ModuleSettings.Default` (in Assist.Shared), loaded in `App.axaml.cs: CheckForSettings` and saved via `.Save()`.

**Startup is a linear async gauntlet** in `ViewModels/Startup/StartupViewModel.cs: Startup()`, fired from `StartupView`'s `Loaded` event. In order: dependency download → update check → setup wizard gate → Assist account refresh-token login → Assist server connect → mode branch (`GAME_ONLY` vs launcher) → Valorant-running check → account auth loop over stored profiles. Each stage can navigate away and `return`. Startup bugs are almost always "one of these stages threw or hung"; the log names each stage.

**Two modes** (`EAssistMode`): launcher mode (dashboard/store/account switching) and game mode (live match tracking), swapped by `SwapAssistMode`. Game mode is entered automatically when `VALORANT-Win64-Shipping` is running.

**Riot auth uses curl, not HttpClient.** `AuthenticateProfile` builds a `RiotUser` with `AuthenticationMethod.CURL`, pointing at `%AppData%\AssistData\Deps\curl\curl.exe` downloaded by `Assist.Shared/Services/Utils/DependencyUtils.cs`, falling back to `curl` on PATH. Stored accounts are cookie-based (`Convert64ToCookies`), and a failed reauth marks the profile `IsExpired`/`CanAssistBoot = false`.

**Views/ViewModels pair by folder** (`Views/Game/X.axaml` ↔ `ViewModels/Game/XViewModel.cs`), CommunityToolkit.Mvvm source generators (`[ObservableProperty]`, `[RelayCommand]`). Navigation buttons are registered through the static `Services/Navigation/NavigationService`.

## Riot data tables go stale

`Helpers/ValorantHelper.cs` holds hardcoded dictionaries mapping Riot IDs/paths to display names (maps, agents, queues, servers). Riot ships new maps and modes at any time, so **never index these dictionaries directly** — an unknown key throws `KeyNotFoundException` on the UI dispatcher and takes the app down (this is what broke startup for `/game/maps/duel/duel_1/skirmish_a`). Use `ValorantHelper.GetMapNameByPath()` or `TryGetValue`.

## Conventions worth keeping

- Serilog `Log.Information` at every step of long flows — the log is the only debugger for user-reported issues.
- Anything touching UI from a background continuation goes through `Dispatcher.UIThread`.
