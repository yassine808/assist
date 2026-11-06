# WinGet manifest

`manifests/y/Yassine808/RiotSwitcher/<version>/` is the manifest submitted to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). Once merged,
Windows users can install with:

```powershell
winget install Yassine808.RiotSwitcher
```

## Per release

1. Publish a GitHub release whose asset is `RiotSwitcher-Setup-x.y.z.exe`.
2. Copy the previous version's folder to the new version number and update:
   - `PackageVersion` in all three files,
   - `InstallerUrl` and `InstallerSha256` in `*.installer.yaml` (GitHub's
     release API exposes the asset digest),
   - `ReleaseDate` and `ReleaseNotesUrl` in the locale file and installer file.
3. Validate and submit:

```powershell
winget validate --manifest packaging\winget\manifests\y\Yassine808\RiotSwitcher\<version>
wingetcreate submit --token $env:GH_TOKEN packaging\winget\manifests\y\Yassine808\RiotSwitcher\<version>
```

`wingetcreate` forks `microsoft/winget-pkgs`, commits the manifest and opens the
pull request. Wait for the moderation bot before announcing the package.

## Local check without a release

`winget validate` is enough to catch schema errors. Installing from the manifest
requires the asset URL to exist.
