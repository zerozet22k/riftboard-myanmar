param(
    [string]$LocalAppUrl = "http://127.0.0.1:3000",
    [int]$Limit = 200,
    [int]$DelayMs = 900,
    [Nullable[int]]$CooldownMs = $null,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

$argsList = @("--limit=$Limit", "--delayMs=$DelayMs")

if ($CooldownMs -ne $null) {
    $argsList += "--cooldownMs=$CooldownMs"
}

if ($Force.IsPresent) {
    $argsList += "--force=1"
}

Write-Host "Running local leaderboard cron against $LocalAppUrl" -ForegroundColor Cyan
Write-Host "Args: $($argsList -join ' ')" -ForegroundColor DarkGray

Push-Location $repoRoot
try {
    $env:LOCAL_APP_URL = $LocalAppUrl
    & npm.cmd run refresh:leaderboard:local -- @argsList
}
finally {
    Pop-Location
}
