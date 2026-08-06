# Account Switcher

A minimal WPF (.NET 8, Windows) account switcher, inspired by
[HeyM1ke/Assist](https://github.com/HeyM1ke/Assist). This is just the
account-switcher piece — no dashboard/store/LIVE features.

## How it works

- You add an account by pasting its **ssid** value (the session cookie
  Riot Client already stores locally once you're logged in). Nothing is
  scraped or guessed — you copy it from your own machine.
- Accounts are saved locally, encrypted with Windows DPAPI
  (`%LOCALAPPDATA%\AccountSwitcher\accounts.dat`) — readable only by your
  Windows user account.
- "Switch" closes Riot Client, writes the chosen ssid into
  `RiotClientPrivateSettings.yaml`, and relaunches the client, so it opens
  already signed in.

## Getting the ssid value for an account

1. Log into that account normally through Riot Client once.
2. Open `%LOCALAPPDATA%\Riot Games\Riot Client\Data\RiotClientPrivateSettings.yaml`
   in a text editor and copy the value of the `ssid` key.
3. Paste it into the app's "ssid cookie value" field along with a name for
   the account.

Riot occasionally changes this file's format between client versions —
if "Switch" fails, open `Services/RiotClientService.cs` and check that
`SsidKeyPattern` still matches the key name in your local file.

## Build & run

Requires the .NET 8 SDK and Windows (WPF only builds on Windows).

```
dotnet build
dotnet run --project AccountSwitcher
```

## Project layout

```
AccountSwitcher.sln
AccountSwitcher/
  App.xaml(.cs)
  MainWindow.xaml(.cs)      # UI: list, add, switch, remove
  Models/Account.cs         # account record
  Services/AccountStore.cs  # encrypted local persistence
  Services/RiotClientService.cs  # close/patch/relaunch Riot Client
```
