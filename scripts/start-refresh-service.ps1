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
$repoRoot = Split-Path -Parent $scriptDir
$serviceScript = Join-Path $scriptDir "refresh-service.ps1"
$servicePattern = [regex]::Escape($serviceScript)
$pidFile = Join-Path $repoRoot ".refresh-service.pid"
$outLog = Join-Path $repoRoot ".refresh-service.out.log"
$errLog = Join-Path $repoRoot ".refresh-service.err.log"
$existingProc = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "powershell.exe" -and $_.CommandLine -match $servicePattern
} | Select-Object -First 1

if ($existingProc) {
    Write-Host "Refresh service already running (PID $($existingProc.ProcessId))." -ForegroundColor Yellow
    Set-Content -LiteralPath $pidFile -Value $existingProc.ProcessId
    exit 0
}

if (Test-Path $pidFile) {
    $existingPid = [int](Get-Content $pidFile | Select-Object -First 1)
    if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
        Write-Host "Refresh service already running (PID $existingPid)." -ForegroundColor Yellow
        exit 0
    }

    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue

$argList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $serviceScript,
    "-LocalAppUrl", $LocalAppUrl,
    "-Limit", $Limit,
    "-IntervalSec", $IntervalSec,
    "-StartupTimeoutSec", $StartupTimeoutSec
)

if ($CooldownMs -ne $null) {
    $argList += @("-CooldownMs", $CooldownMs)
}

if ($Force.IsPresent) {
    $argList += "-Force"
}

if ($SyncMatches.IsPresent) {
    $argList += @("-SyncMatches", "-MatchesCount", $MatchesCount)
}

$proc = Start-Process `
    -FilePath "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList $argList `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

Start-Sleep -Seconds 2

if ($proc.HasExited) {
    $outTail = if (Test-Path $outLog) { (Get-Content $outLog -Tail 40) -join [Environment]::NewLine } else { "" }
    $errTail = if (Test-Path $errLog) { (Get-Content $errLog -Tail 40) -join [Environment]::NewLine } else { "" }
    throw "Refresh service exited immediately.`nSTDOUT:`n$outTail`nSTDERR:`n$errTail"
}

Set-Content -LiteralPath $pidFile -Value $proc.Id
Write-Host "Refresh service started in background (PID $($proc.Id))." -ForegroundColor Green
Write-Host "Logs: $outLog" -ForegroundColor DarkGray
