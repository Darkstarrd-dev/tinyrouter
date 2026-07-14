# build-minimal-webview-pg.ps1
#
# Extreme-size build of the TinyRouter "webview + playground + stripped" variant.
# Produces: tinyrouter-webview-pg-stripped.exe (then UPX-packed to *.upx.exe).
#
# Aggressive size minimization pipeline:
#   1. Go compiler flags:
#        - CGO_ENABLED=0            pure Go, no C runtime / libgcc embedded
#        - -tags "tray,webview,playground"   the webview+pg variant
#        - -ldflags "-H windowsgui -s -w -buildid="
#              -H windowsgui        GUI subsystem (no console window)
#              -s                   strip symbol table
#              -w                   strip DWARF debug info (no dlv debugging)
#              -buildid=            drop the build-id string
#        - -gcflags="all=-l"        disable inlining -> smaller code size
#        - -trimpath               remove absolute filesystem paths
#   2. UPX --best --ultra-brute    pack the resulting PE for max compression.
#
# Result is roughly: ~17 MB stripped -> ~6 MB packed.
#
# Usage:
#   ./build-minimal-webview-pg.ps1                  # build + UPX-pack
#   ./build-minimal-webview-pg.ps1 -NoUpx           # build only, skip packing
#   ./build-minimal-webview-pg.ps1 -OutputDir dist  # custom output dir

param(
    [string]$OutputDir = "dist",

    # Set to skip the UPX packing step (keep the stripped PE only).
    [switch]$NoUpx,

    # Force a fresh rsrc.syso regeneration even if it looks up to date.
    [switch]$ForceSyso
)

$ErrorActionPreference = "Stop"

# --- Locate UPX --------------------------------------------------------------
$UPX_EXE = $null
foreach ($cand in @(
        (Get-Command upx -ErrorAction SilentlyContinue).Source,
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\UPX.UPX_Microsoft.Winget.Source_8wekyb3d8bbwe\upx-5.2.0-win64\upx.exe"
    )) {
    if ($cand -and (Test-Path $cand)) { $UPX_EXE = $cand; break }
}

# --- Ensure rsrc.syso exists --------------------------------------------------
function Invoke-EnsureSyso {
    $needGenerate = $ForceSyso
    if (-not (Test-Path rsrc.syso)) {
        $needGenerate = $true
    } else {
        foreach ($dep in @("web/static/favicon.ico", "rsrc.manifest")) {
            if ((Test-Path $dep) -and
                (Get-Item $dep).LastWriteTime -gt (Get-Item rsrc.syso).LastWriteTime) {
                $needGenerate = $true; break
            }
        }
    }
    if ($needGenerate) {
        Write-Host "Regenerating rsrc.syso from web/static/favicon.ico + rsrc.manifest..."
        & go generate ./...
        if ($LASTEXITCODE -ne 0) {
            Write-Error "go generate failed (install rsrc: go install github.com/akavel/rsrc@latest)"
            exit $LASTEXITCODE
        }
    }
}

# --- Build -------------------------------------------------------------------
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

Invoke-EnsureSyso

$outName = "tinyrouter-webview-pg-stripped.exe"
$outPath = "$OutputDir/$outName"

$tags    = "tray,webview,playground"
$ldflags = "-H windowsgui -s -w -buildid="
$gcflags = "all=-l"

Write-Host "=== Building extreme-minimal webview+pg+stripped ==="
Write-Host ("  tags:    {0}" -f $tags)
Write-Host ("  ldflags: {0}" -f $ldflags)
Write-Host ("  gcflags: {0}" -f $gcflags)
Write-Host ("  CGO_ENABLED=0  -trimpath")

$env:CGO_ENABLED = "0"
$buildArgs = @(
    "build",
    "-tags", $tags,
    "-ldflags", $ldflags,
    "-gcflags", $gcflags,
    "-trimpath",
    "-o", $outPath,
    "."
)
& go @buildArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed for $outName"
    exit $LASTEXITCODE
}

$rawSize = (Get-Item $outPath).Length
Write-Host ("Stripped: {0} ({1:N0} bytes / {2:N2} MB)" -f $outName, $rawSize, ($rawSize / 1MB))

# --- UPX pack ----------------------------------------------------------------
$packedPath = "$OutputDir/tinyrouter-webview-pg-stripped.upx.exe"
if (-not $NoUpx) {
    if (-not $UPX_EXE) {
        Write-Warning "UPX not found; skipping compression. Install via: winget install UPX.UPX"
    } else {
        Write-Host ("Packing with UPX --best --ultra-brute -> {0}" -f (Split-Path $packedPath -Leaf))
        & $UPX_EXE --best --ultra-brute -o $packedPath $outPath
        if ($LASTEXITCODE -ne 0) {
            Write-Error "UPX packing failed"
            exit $LASTEXITCODE
        }

        # Integrity test on the packed binary.
        & $UPX_EXE -t $packedPath | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "UPX integrity test failed on packed binary"
            exit $LASTEXITCODE
        }

        $packedSize = (Get-Item $packedPath).Length
        $ratio = 1 - ($packedSize / $rawSize)
        Write-Host ("Packed:   {0} ({1:N0} bytes / {2:N2} MB, saved {3:P1})" -f (Split-Path $packedPath -Leaf), $packedSize, ($packedSize / 1MB), $ratio)

        # Replace the uncompressed artifact with the packed one as the primary output.
        Move-Item -Force $packedPath $outPath
        Write-Host ("Final:    {0} ({1:N0} bytes / {2:N2} MB)" -f $outName, $packedSize, ($packedSize / 1MB))
    }
}

Write-Host "`n=== Done ==="
Get-ChildItem "$OutputDir/tinyrouter-webview-pg-stripped*.exe" | Sort-Object Name |
    ForEach-Object { "{0,-44} {1,11:N0} bytes ({2,6:N2} MB)" -f $_.Name, $_.Length, ($_.Length / 1MB) }
