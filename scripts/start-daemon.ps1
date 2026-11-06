<#
.SYNOPSIS
  Starts the Memory Loop daemon on a non-default port.

  Uses a dedicated application root (outside the checkout) so it never touches the
  checkout's default .memory-loop selection. On first run it initializes that root:
  transport + service token (via setup:transport), the daemon port, and the vault config.
  On first run, pass -VaultDirectory 'C:\path\to\vault'. Later runs reuse the
  saved selection without an argument. Stop with Ctrl+C in this terminal.
#>
param(
    [string]$VaultDirectory
)

$ErrorActionPreference = 'Stop'

# Works on both Windows PowerShell 5.1 and PowerShell 7 (5.1 has no utf8NoBOM encoding).
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

$DaemonPort     = 4101
$AppRoot        = Join-Path $env:LOCALAPPDATA 'memory-loop\second-brain'
# Written by the running OpenCode service (url/pid/version/password); Think attaches to it.
$RegistrationFile = Join-Path $env:USERPROFILE '.local\state\opencode\service.json'

$repoRoot      = Split-Path -Parent $PSScriptRoot
$stateDir      = Join-Path $AppRoot '.memory-loop'
$transportFile = Join-Path $stateDir 'transport.json'
$configFile    = Join-Path $stateDir 'config.json'

function Assert-VaultDirectory([string]$Path) {
    $absolute = -not [string]::IsNullOrWhiteSpace($Path) -and [IO.Path]::IsPathRooted($Path)
    # Windows PowerShell 5.1 lacks Path.IsPathFullyQualified; reject drive-relative
    # and current-drive-rooted paths as well as ordinary relative paths.
    if ($absolute -and [IO.Path]::DirectorySeparatorChar -eq '\') {
        $absolute = $Path -match '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)'
    }
    if (-not $absolute -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw 'VaultDirectory must be an absolute path to an existing directory.'
    }
}

# Select and validate the vault before setup or any changes to existing state.
$config = $null
if (Test-Path -LiteralPath $configFile) {
    $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $config -or $config.vaultDirectory -isnot [string]) {
        throw 'Saved configuration must contain a valid vaultDirectory.'
    }
    Assert-VaultDirectory $config.vaultDirectory
    if ($PSBoundParameters.ContainsKey('VaultDirectory')) {
        Assert-VaultDirectory $VaultDirectory
        if ($config.vaultDirectory -ne $VaultDirectory) {
            throw 'The supplied VaultDirectory differs from the saved selection. Edit the config manually to change vaults.'
        }
    }
    $VaultDirectory = $config.vaultDirectory
} else {
    Assert-VaultDirectory $VaultDirectory
}

# 1. Application root + transport/token (setup refuses to replace existing credentials).
New-Item -ItemType Directory -Force -Path $AppRoot | Out-Null
if (-not (Test-Path -LiteralPath $transportFile)) {
    Push-Location $repoRoot
    try {
        bun --no-env-file run setup:transport --project-root $AppRoot
        if ($LASTEXITCODE -ne 0) { throw 'setup:transport failed' }
    } finally { Pop-Location }
}

# 2. Point the private daemon origin at the non-default port.
$origin = "http://127.0.0.1:$DaemonPort"
$transport = Get-Content -LiteralPath $transportFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($transport.daemonOrigin -ne $origin) {
    Write-Utf8NoBom $transportFile (@{ daemonOrigin = $origin } | ConvertTo-Json)
    Write-Host "Set daemonOrigin to $origin"
}

# 3. Vault + Think selection. The vault is never silently replaced; a missing
#    Think block is added (without it, every Think request returns 503).
if (-not (Test-Path -LiteralPath $RegistrationFile)) {
    Write-Warning "OpenCode registration not found at $RegistrationFile - is the OpenCode service running? Think will be unavailable (503)."
}
$think = [ordered]@{
    service              = [ordered]@{ registrationFile = $RegistrationFile; requiredVersion = '2.2.2' }
    location             = @{ kind = 'vault' }
    permissionMode       = 'full'
    transcriptDirectory  = 'Conversations/Memory Loop'
}
if (-not (Test-Path -LiteralPath $configFile)) {
    $config = [ordered]@{ vaultDirectory = $VaultDirectory; think = $think }
    Write-Utf8NoBom $configFile ($config | ConvertTo-Json -Depth 10)
    Write-Host "Wrote config: $configFile"
} else {
    if (-not $config.PSObject.Properties['think']) {
        $config | Add-Member -NotePropertyName think -NotePropertyValue $think
        Write-Utf8NoBom $configFile ($config | ConvertTo-Json -Depth 10)
        Write-Host "Added Think configuration to $configFile"
    }
}

# 4. Run the daemon.
$env:MEMORY_LOOP_TRANSPORT_FILE = $transportFile
Write-Host "Daemon: $origin  vault: $VaultDirectory  root: $AppRoot"
Push-Location $repoRoot
try {
    bun --no-env-file run daemon --project-root $AppRoot --port $DaemonPort
} finally { Pop-Location }
