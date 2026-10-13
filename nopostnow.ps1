# NoPostNow launcher for Windows.
#
#   .\nopostnow.cmd            open the control panel (sets up on first run)
#   .\nopostnow.cmd start      run in the terminal, with no window
#   .\nopostnow.cmd setup      change settings from the terminal
#   .\nopostnow.cmd users ...  manage accounts
#
# Needs Node.js 22.18 or newer. If it is missing, this script downloads an
# official copy into .\.runtime - nothing is installed system-wide.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$NodeVersion = "v24.21.0"
$Runtime = Join-Path $PSScriptRoot ".runtime\node"

function Test-Node([string]$Exe) {
  try {
    & $Exe -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>$null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

$localNode = Join-Path $Runtime "node.exe"
if ((Test-Path $localNode) -and (Test-Node $localNode)) {
  $env:Path = "$Runtime;$env:Path"
} elseif ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Node "node")) {
  # A suitable Node.js is already installed.
} else {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $name = "node-$NodeVersion-win-$arch"
  $base = "https://nodejs.org/dist/$NodeVersion"
  $zip = Join-Path $PSScriptRoot ".runtime\$name.zip"
  Write-Host "Node.js 22.18+ was not found. Downloading $name.zip from nodejs.org ..."
  New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot ".runtime") | Out-Null
  Invoke-WebRequest -Uri "$base/$name.zip" -OutFile $zip -UseBasicParsing
  $sums = (Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing).Content
  $want = ($sums -split "`n" | Where-Object { $_ -match "  $([regex]::Escape($name)).zip$" }) -replace "\s.*$", ""
  $got = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
  if (-not $want -or $want.Trim().ToLower() -ne $got) {
    Remove-Item -Force $zip
    throw "The download did not match its published checksum. Nothing was installed."
  }
  if (Test-Path $Runtime) { Remove-Item -Recurse -Force $Runtime }
  Expand-Archive -Path $zip -DestinationPath (Join-Path $PSScriptRoot ".runtime") -Force
  Rename-Item -Path (Join-Path $PSScriptRoot ".runtime\$name") -NewName "node"
  Remove-Item -Force $zip
  $env:Path = "$Runtime;$env:Path"
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies (one time) ..."
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$command = if ($args.Count -gt 0) { $args[0] } else { "panel" }
$rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

switch ($command) {
  "panel" { node scripts/panel.mjs @rest; exit $LASTEXITCODE }
  "setup" { node scripts/setup.mjs @rest; exit $LASTEXITCODE }
  "users" { node scripts/users.mjs @rest; exit $LASTEXITCODE }
  "start" {
    # Terminal only, no window. First run walks through setup.
    node scripts/configured.mjs
    if ($LASTEXITCODE -ne 0) {
      node scripts/setup.mjs
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    node scripts/start.mjs
    exit $LASTEXITCODE
  }
  default { Write-Host "Usage: .\nopostnow.cmd [panel | start | setup | users ...]"; exit 1 }
}
