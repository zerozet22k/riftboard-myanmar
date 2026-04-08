$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$serviceScript = Join-Path $scriptDir "refresh-service.ps1"
$servicePattern = [regex]::Escape($serviceScript)
$pidFile = Join-Path $repoRoot ".refresh-service.pid"

if (-not (Test-Path $pidFile)) {
    $fallback = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq "powershell.exe" -and $_.CommandLine -match $servicePattern
    } | Select-Object -First 1

    if (-not $fallback) {
        Write-Host "Refresh service is not running." -ForegroundColor Yellow
        exit 0
    }

    $pidValue = [int]$fallback.ProcessId
} else {
    $pidValue = [int](Get-Content $pidFile | Select-Object -First 1)
}
$proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue

if ($proc) {
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped refresh service (PID $pidValue)." -ForegroundColor Green
} else {
    Write-Host "Refresh service PID file was stale." -ForegroundColor Yellow
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
