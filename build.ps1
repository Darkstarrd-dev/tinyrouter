# TinyRouter build presets
# Usage:
#   ./build.ps1                                  # default: console + browser, no playground
#   ./build.ps1 -Strip                           # + minimal size (stripped symbols)
#   ./build.ps1 -Playground                      # include playground module (build tag)
#   ./build.ps1 -Variant tray                    # tray-resident, hidden console
#   ./build.ps1 -Variant tray -Playground -Strip # tray + playground + minimal size
#   ./build.ps1 -Variant webview                 # tray + native WebView2 window (needs CGO)
#   ./build.ps1 -Variant debug                   # no flags, full DWARF for dlv
#
# Output matrix (host x playground x strip):
#   - Variant default|tray|webview|debug
#   - Playground switch toggles the `playground` build tag (embeds playground assets)
#   - Strip switch toggles -s -w (smaller binary, no DWARF/symtab)
#
# All artifacts land in ./dist/ with descriptive names:
#   tinyrouter.exe                        default console (current behavior)
#   tinyrouter-pg.exe                     default console + playground
#   tinyrouter-tray.exe                    tray resident
#   tinyrouter-tray-pg.exe                tray + playground
#   tinyrouter-tray-stripped.exe           tray + strip
#   tinyrouter-tray-pg-stripped.exe       tray + playground + strip
#   tinyrouter-webview.exe                tray + WebView2 window (CGO)
#   tinyrouter-webview-pg.exe             tray + WebView2 + playground
#   tinyrouter-debug.exe                   full DWARF, no stripping, console window

param(
    [ValidateSet("default", "tray", "webview", "debug")]
    [string]$Variant = "default",

    [switch]$Playground,
    [switch]$Strip,

    [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"
$goarch = "amd64"

# --- Build tag set + ldflags per variant -------------------------------------
$tags = @()
$ldflags = @()
$needsCgo = $false

switch ($Variant) {
    "default" {
        # Current behavior: console subsystem + auto-open browser.
        $base = "tinyrouter"
    }
    "tray" {
        $tags += "tray"
        $ldflags += "-H windowsgui"   # hide console window
        $base = "tinyrouter-tray"
    }
    "webview" {
        $tags += "tray", "webview"
        $ldflags += "-H windowsgui"
        $needsCgo = $true              # webview/webview_go needs CGO + WebView2
        $base = "tinyrouter-webview"
    }
    "debug" {
        # No flags: full DWARF, no stripping, console window.
        # Strip is forcibly ignored for debug variant below.
        $base = "tinyrouter-debug"
    }
}

# --- Playground tag ---------------------------------------------------------
if ($Playground) {
    $tags += "playground"
}

# --- Strip (ignored for debug variant; debug always keeps full DWARF) -------
if ($Strip -and $Variant -ne "debug") {
    $ldflags += "-s", "-w"
}

# --- Output filename composition -------------------------------------------
# Order of suffixes: -pg (if playground), -stripped (if strip), then .exe
# debug variant ignores both playground and strip in the name for clarity.
$nameParts = @($base)
if ($Playground -and $Variant -ne "debug") { $nameParts += "pg" }
if ($Strip -and $Variant -ne "debug") { $nameParts += "stripped" }
$out = ($nameParts -join "-") + ".exe"

# --- Build artefact directory ----------------------------------------------
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# --- Assemble go build args -------------------------------------------------
$buildArgs = @("build")
if ($tags.Count -gt 0) { $buildArgs += "-tags", ($tags -join ",") }
if ($ldflags.Count -gt 0) { $buildArgs += "-ldflags", ($ldflags -join " ") }
$buildArgs += "-o", "$OutputDir/$out", "."

$env:CGO_ENABLED = if ($needsCgo) { "1" } else { "0" }

# --- Run build --------------------------------------------------------------
Write-Host "Building $Variant -> $OutputDir/$out"
Write-Host ("  tags:    {0}" -f ($tags -join ','))
Write-Host ("  ldflags: {0}" -f ($ldflags -join ' '))
Write-Host "  cgo:     $env:CGO_ENABLED"

& go @buildArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed"
    exit $LASTEXITCODE
}

$size = (Get-Item "$OutputDir/$out").Length
Write-Host ("Done: {0} ({1:N0} bytes / {2:N2} MB)" -f $out, $size, ($size / 1MB))
