# Standalone regression: powershell -NoProfile -File scripts/start-daemon.test.ps1
# Runs a copy of the launcher with disposable directories and a fake bun command.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('memory-loop-launcher-test-' + [guid]::NewGuid().ToString('N'))
$oldLocalAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA', 'Process')
$oldUserProfile = [Environment]::GetEnvironmentVariable('USERPROFILE', 'Process')
$oldTransport = [Environment]::GetEnvironmentVariable('MEMORY_LOOP_TRANSPORT_FILE', 'Process')
$oldExitCode = $global:LASTEXITCODE

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
}

# The launcher calls this function instead of any installed bun executable.
function bun {
    $script:bunCalls++
    $global:LASTEXITCODE = 0
    if ($args -contains 'setup:transport') {
        $metadata = Join-Path $script:appRoot '.memory-loop'
        New-Item -ItemType Directory -Force -Path $metadata | Out-Null
        [IO.File]::WriteAllText((Join-Path $metadata 'transport.json'), '{"daemonOrigin":"http://127.0.0.1:3001"}')
        [IO.File]::WriteAllText((Join-Path $metadata 'service.token'), 'fixture-token')
    } elseif ($args -notcontains 'daemon') {
        throw 'Unexpected fake bun command'
    }
}

function Invoke-Launcher([hashtable]$Arguments, [bool]$ShouldSucceed, [string]$Case) {
    $succeeded = $false
    try {
        & $script:launcher @Arguments *> $null
        $succeeded = $true
    } catch {
        # Do not print launcher errors: they can contain paths.
    }
    Assert-True ($succeeded -eq $ShouldSucceed) $Case
}

try {
    $local = Join-Path $root 'local'
    $profile = Join-Path $root 'profile'
    $repo = Join-Path $root 'repo'
    $scripts = Join-Path $repo 'scripts'
    # Construct the non-ASCII name without relying on the script file encoding in PS 5.1.
    $vault = Join-Path $root ('vault-' + [char]0x4e2d)
    $otherVault = Join-Path $root 'other-vault'
    New-Item -ItemType Directory -Path $local, $profile, $scripts, $vault, $otherVault -Force | Out-Null
    $env:LOCALAPPDATA = $local
    $env:USERPROFILE = $profile
    $script:appRoot = Join-Path $local 'memory-loop\second-brain'
    $script:launcher = Join-Path $scripts 'start-daemon.ps1'
    $configFile = Join-Path $script:appRoot '.memory-loop\config.json'
    $transportFile = Join-Path $script:appRoot '.memory-loop\transport.json'
    $script:bunCalls = 0
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start-daemon.ps1') -Destination $script:launcher

    Invoke-Launcher @{} $false 'first run without a vault must fail'
    Assert-True (-not (Test-Path -LiteralPath $script:appRoot)) 'missing argument must not create application state'
    Assert-True ($script:bunCalls -eq 0) 'missing argument must not invoke bun'

    Invoke-Launcher @{ VaultDirectory = $vault } $true 'first run with a fixture vault must succeed'
    $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($config.vaultDirectory -eq $vault) 'first run must persist the selected vault'
    Assert-True ($script:bunCalls -eq 2) 'first run must invoke setup and daemon'

    $config | Add-Member -NotePropertyName fixtureUnrelated -NotePropertyValue 'preserve-me'
    [IO.File]::WriteAllText($configFile, ($config | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    Invoke-Launcher @{} $true 'later run without a vault must succeed'
    $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($config.vaultDirectory -eq $vault -and $config.fixtureUnrelated -eq 'preserve-me') 'reuse must preserve the saved vault and unrelated fields'
    Assert-True ($script:bunCalls -eq 3) 'reuse must invoke daemon without repeating setup'

    # A stale but valid origin exposes any transport rewrite before conflict detection.
    [IO.File]::WriteAllText($transportFile, '{"daemonOrigin":"http://127.0.0.1:3001"}')
    $beforeConfig = [IO.File]::ReadAllBytes($configFile)
    $beforeTransport = [IO.File]::ReadAllBytes($transportFile)
    $beforeCalls = $script:bunCalls
    Invoke-Launcher @{ VaultDirectory = $otherVault } $false 'conflicting vault must fail'
    Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($configFile)) -eq [Convert]::ToBase64String($beforeConfig)) 'conflict must not change config'
    Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($transportFile)) -eq [Convert]::ToBase64String($beforeTransport)) 'conflict must not change transport'
    Assert-True ($script:bunCalls -eq $beforeCalls) 'conflict must not invoke bun'

    $unavailableVault = @{ vaultDirectory = (Join-Path $root 'missing-vault') } | ConvertTo-Json -Compress
    foreach ($invalid in @('{', '{}', '{"vaultDirectory":""}', '{"vaultDirectory":"relative-vault"}', $unavailableVault)) {
        [IO.File]::WriteAllText($configFile, $invalid)
        Invoke-Launcher @{} $false 'invalid saved vault must fail'
        Assert-True ([IO.File]::ReadAllText($configFile) -eq $invalid) 'invalid config must not be rewritten'
        Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($transportFile)) -eq [Convert]::ToBase64String($beforeTransport)) 'invalid config must not change transport'
        Assert-True ($script:bunCalls -eq $beforeCalls) 'invalid config must not invoke bun'
    }
    Write-Host 'Launcher regression checks passed.'
} finally {
    [Environment]::SetEnvironmentVariable('LOCALAPPDATA', $oldLocalAppData, 'Process')
    [Environment]::SetEnvironmentVariable('USERPROFILE', $oldUserProfile, 'Process')
    [Environment]::SetEnvironmentVariable('MEMORY_LOOP_TRANSPORT_FILE', $oldTransport, 'Process')
    $global:LASTEXITCODE = $oldExitCode
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
