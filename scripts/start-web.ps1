<#
.SYNOPSIS
  Starts the Memory Loop web server (next start) on a non-default port, wired to the
  daemon started by start-daemon.ps1. On first setup, run start-daemon.ps1
  -VaultDirectory 'C:\path\to\vault' to initialize the application root.
  Requires a prior `bun run build`.
  Stop with Ctrl+C in this terminal.
#>
$ErrorActionPreference = 'Stop'

$WebPort = 4100
$AppRoot = Join-Path $env:LOCALAPPDATA 'memory-loop\second-brain'

$repoRoot      = Split-Path -Parent $PSScriptRoot
$transportFile = Join-Path $AppRoot '.memory-loop\transport.json'

if (-not (Test-Path -LiteralPath $transportFile)) {
    throw "Transport not initialized at $transportFile. Run scripts\start-daemon.ps1 first."
}
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.next\BUILD_ID'))) {
    throw "No production build found. Run 'bun run build' in $repoRoot first."
}

$env:MEMORY_LOOP_TRANSPORT_FILE = $transportFile
Write-Host "Web: http://127.0.0.1:$WebPort  (transport: $transportFile)"
Push-Location $repoRoot
try {
    bun --no-env-file run server --hostname 127.0.0.1 --port $WebPort
} finally { Pop-Location }
