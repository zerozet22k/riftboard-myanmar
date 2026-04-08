param(
    [string]$LocalAppUrl = "http://127.0.0.1:3000",
    [int]$Limit = 5,
    [int]$IntervalSec = 300,
    [Nullable[int]]$CooldownMs = $null,
    [switch]$Force,
    [switch]$SyncMatches,
    [int]$MatchesCount = 10,
    [int]$StartupTimeoutSec = 45
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerScript = Join-Path $scriptDir "run-local-cron.ps1"
$mutexName = "Local\BurmeseLpRankingRefreshService"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$hasHandle = $false

try {
    $hasHandle = $mutex.WaitOne(0, $false)
    if (-not $hasHandle) {
        Write-Host "Refresh service is already running." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Refresh service started: limit=$Limit interval=${IntervalSec}s syncMatches=$($SyncMatches.IsPresent) matchesCount=$MatchesCount" -ForegroundColor Green

    while ($true) {
        $startedAt = Get-Date
        Write-Host ("[{0}] Refresh tick started" -f $startedAt.ToString("s")) -ForegroundColor Cyan

        $invokeArgs = @{
            LocalAppUrl = $LocalAppUrl
            Limit = $Limit
            StartupTimeoutSec = $StartupTimeoutSec
        }

        if ($CooldownMs -ne $null) {
            $invokeArgs.CooldownMs = $CooldownMs
        }

        if ($Force.IsPresent) {
            $invokeArgs.Force = $true
        }

        if ($SyncMatches.IsPresent) {
            $invokeArgs.SyncMatches = $true
            $invokeArgs.MatchesCount = $MatchesCount
        }

        try {
            & $workerScript @invokeArgs
        }
        catch {
            $message = $_.Exception.Message
            Write-Host "Refresh tick failed: $message" -ForegroundColor Red
        }

        $elapsed = [int][Math]::Ceiling(((Get-Date) - $startedAt).TotalSeconds)
        $sleepSec = [Math]::Max(1, $IntervalSec - $elapsed)
        Write-Host "Next refresh in ${sleepSec}s" -ForegroundColor DarkGray
        Start-Sleep -Seconds $sleepSec
    }
}
finally {
    if ($hasHandle) {
        $mutex.ReleaseMutex()
    }

    $mutex.Dispose()
}
