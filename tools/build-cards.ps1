# Builds the final Static/ + Animated/ tree from the staged texture dumps.
# Read-only against the game; writes only under $root.
$ErrorActionPreference = 'Stop'

$root     = 'D:\Projects\assist\official playercards'
$stage    = Join-Path $root '_stage'
$manifest = 'C:\Riot Games\VALORANT\live\Manifest_UFSFiles_Win64.txt'
$dotnet   = 'D:\Projects\assist\tools\dotnet\dotnet.exe'
$app      = 'D:\Projects\assist\tools\carddump\bin\Release\net10.0\carddump.dll'
$prefix   = 'ShooterGame/Content/Personalization/PlayerCards/'

# Shared sheets that live outside the card folder itself.
$sheetOverrides = @{
    'Val5beta/Val5Beta' = 'Val5beta/val5beta_flipbook_L_1.png'
}

# --- inventory from the cooked manifest -------------------------------------
$paths = Select-String -Path $manifest -Pattern 'Personalization/PlayerCards/' |
    ForEach-Object { ($_.Line -split "`t")[0] } |
    ForEach-Object { $_ -replace [regex]::Escape($prefix), '' } |
    ForEach-Object { $_ -replace '\.uasset$', '' }

$largeRe = '(?i)_L$|_L\d+$|_Large$|_L_[A-Za-z0-9]+$|[a-z]L\d+$'
$largeAll = $paths | Where-Object {
    $_ -match $largeRe -and $_ -notmatch '(?i)(Mask|LUT)'
}

$primaryByFolder = @{}
foreach ($p in ($paths | Where-Object { $_ -match '_PrimaryAsset$' })) {
    $primaryByFolder[($p -replace '/[^/]+$', '')] = ($p -replace '.*/', '') -replace '_PrimaryAsset$', ''
}

# --- staged art --------------------------------------------------------------
$sheets = Get-ChildItem $stage -Recurse -Filter '*.png' |
    Where-Object { $_.BaseName -match 'Sequence|Flipbook|SpriteSheet' -and $_.BaseName -notmatch 'Mask|LUT|Gradient|Speed' } |
    ForEach-Object { [pscustomobject]@{ Full = $_.FullName; Rel = $_.FullName.Substring($stage.Length + 1).Replace('\', '/') } }
"sheets=$($sheets.Count)"

# the staged large textures are the authoritative card list
$stageLarge = Get-ChildItem $stage -Recurse -Filter '*.png' |
    Where-Object { $_.Directory.FullName -notmatch 'Flipbooks?$' } |
    Where-Object { ($_.BaseName -match $largeRe) -and ($_.BaseName -notmatch '(?i)(Mask|LUT)') } |
    Sort-Object FullName
"large art staged=$($stageLarge.Count)"

# folders that only contain a flipbook (animated-only cards, no large texture)
$animOnly = @()
foreach ($s in $sheets) {
    $dir = $s.Rel -replace '/[^/]+$', ''
    $candidates = @($dir, ($dir -replace '/[^/]+$', ''))
    foreach ($c in $candidates) {
        if ($primaryByFolder.ContainsKey($c)) {
            if (-not ($stageLarge | Where-Object { $_.Directory.FullName.Substring($stage.Length + 1).Replace('\', '/') -eq $c })) {
                if (-not ($animOnly | Where-Object { $_.Folder -eq $c })) {
                    $animOnly += [pscustomobject]@{ Folder = $c; Name = $primaryByFolder[$c] }
                }
            }
            break
        }
    }
}
# cards whose sheet is not in their own folder and whose group has several sheets
foreach ($k in $sheetOverrides.Keys) {
    if (-not $primaryByFolder.ContainsKey($k)) { continue }
    $has = @($stageLarge | Where-Object { $_.Directory.FullName.Substring($stage.Length + 1).Replace('\', '/') -eq $k })
    if ($has.Count -gt 0) { continue }
    if (-not ($animOnly | Where-Object { $_.Folder -eq $k })) {
        $animOnly += [pscustomobject]@{ Folder = $k; Name = $primaryByFolder[$k] }
    }
}

"animated-only cards=$($animOnly.Count): " + (($animOnly | ForEach-Object { $_.Name }) -join ', ')

# --- naming ------------------------------------------------------------------
$fullNames = @($stageLarge | ForEach-Object { $_.BaseName }) + @($animOnly | ForEach-Object { $_.Name })
$stripped = @{}
foreach ($n in $fullNames) { $stripped[$n] = ($n -replace '(?i)_L$', '') -replace '(?i)_Large$', '' }
$strippedCount = @{}
foreach ($k in $stripped.Keys) { $strippedCount[$stripped[$k]] = 1 + $strippedCount[$stripped[$k]] }
function CardName([string]$n) {
    $s = $stripped[$n]
    if ($strippedCount[$s] -eq 1) { return $s }
    return $n
}

$staticDir = Join-Path $root 'Static'
$animDir   = Join-Path $root 'Animated'
foreach ($d in @($staticDir, $animDir)) {
    if (Test-Path $d) { Remove-Item $d -Recurse -Force }
    New-Item -ItemType Directory -Path $d | Out-Null
}

$rows = New-Object System.Collections.Generic.List[object]
$i = 0
foreach ($f in $stageLarge) {
    $i++
    $folder = $f.Directory.FullName.Substring($stage.Length + 1).Replace('\', '/')
    $name   = CardName $f.BaseName

    $sheet = $null
    if ($sheetOverrides.ContainsKey($folder)) {
        $sheet = $sheets | Where-Object { $_.Rel -eq $sheetOverrides[$folder] }
    }
    if (-not $sheet) {
        $own = @($sheets | Where-Object { $_.Rel.StartsWith("$folder/") })
        if ($own.Count -eq 1) { $sheet = $own[0] }
        elseif ($own.Count -gt 1) { $sheet = $own | Select-Object -First 1 }
        else {
            $group = $folder.Split('/')[0]
            $sib = @($sheets | Where-Object { $_.Rel.Split('/')[0] -eq $group })
            if ($sib.Count -eq 1) { $sheet = $sib[0] }
        }
    }

    if ($sheet) {
        $dest = Join-Path $animDir $name
        $out = & $dotnet $app --mode animate --file $sheet.Full --out $dest 2>&1
        $line = ($out | Select-String 'frames of' | Select-Object -Last 1).ToString()
        if (-not $line) { "ANIMATE FAILED: $name`n$out"; exit 1 }
        $m = [regex]::Match($line, '->\s+(\d+)x(\d+)\s+=\s+(\d+)\s+frames of\s+([\d.]+)x([\d.]+)\s+\((\w+)\)')
        $rows.Add([pscustomobject]@{
            name = $name; kind = 'flipbook'; folder = $folder; art = $f.BaseName; sheet = $sheet.Rel
            cols = [int]$m.Groups[1].Value; rows_ = [int]$m.Groups[2].Value; frames = [int]$m.Groups[3].Value
            frame_w = $m.Groups[4].Value; frame_h = $m.Groups[5].Value; grid_source = $m.Groups[6].Value
        }) | Out-Null
    } else {
        $kind = 'static'
        if ($primaryByFolder.ContainsKey($folder)) {
            $miFolder = $folder
            if (@($paths | Where-Object { $_ -like "$miFolder/*Animation_MI" }).Count -gt 0) { $kind = 'procedural' }
        }
        Copy-Item $f.FullName (Join-Path $staticDir "$name.png") -Force
        $rows.Add([pscustomobject]@{
            name = $name; kind = $kind; folder = $folder; art = $f.BaseName; sheet = ''
            cols = 0; rows_ = 0; frames = 1; frame_w = ''; frame_h = ''; grid_source = ''
        }) | Out-Null
    }

    if ($i % 100 -eq 0) { "  [$i/$($stageLarge.Count)] $name" }
}

foreach ($a in $animOnly) {
    $sheet = $null
    if ($sheetOverrides.ContainsKey($a.Folder)) {
        $sheet = $sheets | Where-Object { $_.Rel -eq $sheetOverrides[$a.Folder] }
    }
    if (-not $sheet) {
        $own = @($sheets | Where-Object { $_.Rel.StartsWith("$($a.Folder)/") })
        if ($own.Count -ge 1) { $sheet = $own | Select-Object -First 1 }
    }
    if (-not $sheet) { "no sheet for animated-only $($a.Name)"; continue }
    $name = $a.Name
    $dest = Join-Path $animDir $name
    $out = & $dotnet $app --mode animate --file $sheet.Full --out $dest 2>&1
    $line = ($out | Select-String 'frames of' | Select-Object -Last 1).ToString()
    if (-not $line) { "ANIMATE FAILED: $name`n$out"; exit 1 }
    $m = [regex]::Match($line, '->\s+(\d+)x(\d+)\s+=\s+(\d+)\s+frames of\s+([\d.]+)x([\d.]+)\s+\((\w+)\)')
    $rows.Add([pscustomobject]@{
        name = $name; kind = 'flipbook'; folder = $a.Folder; art = ''; sheet = $sheet.Rel
        cols = [int]$m.Groups[1].Value; rows_ = [int]$m.Groups[2].Value; frames = [int]$m.Groups[3].Value
        frame_w = $m.Groups[4].Value; frame_h = $m.Groups[5].Value; grid_source = $m.Groups[6].Value
    }) | Out-Null
}

$rows | Sort-Object name | Export-Csv -Path (Join-Path $root 'manifest.csv') -NoTypeInformation -Encoding UTF8

$kinds = $rows | Group-Object kind | ForEach-Object { "$($_.Name)=$($_.Count)" }
"done: $($kinds -join '  ')   total=$($rows.Count)"
"static files = $((Get-ChildItem $staticDir -Filter '*.png').Count)"
"animated dirs = $((Get-ChildItem $animDir -Directory).Count)"
