param(
    [string]$LocalAppUrl = "http://127.0.0.1:3000",
    [int]$Limit = 5,
    [int]$DelayMs = 900,
    [Nullable[int]]$CooldownMs = $null,
    [switch]$Force,
    [switch]$SyncMatches,
    [int]$MatchesCount = 10,
    [int]$StartupTimeoutSec = 45
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$serverOutLog = Join-Path $repoRoot ".standalone-refresh-server.out.log"
$serverErrLog = Join-Path $repoRoot ".standalone-refresh-server.err.log"

function Test-AppReady {
    param([Uri]$Uri)

    try {
        $null = Invoke-WebRequest -Uri $Uri.AbsoluteUri -UseBasicParsing -TimeoutSec 5
        return $true
    }
    catch {
        return $false
    }
}

function Test-PortListening {
    param([Uri]$Uri)

    $port = if ($Uri.Port -gt 0) { $Uri.Port } else { 3000 }
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Get-ProcessTreeIds {
    param([int]$RootPid)

    $all = Get-CimInstance Win32_Process
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $seen = New-Object 'System.Collections.Generic.HashSet[int]'
    $ids = New-Object 'System.Collections.Generic.List[int]'

    $queue.Enqueue($RootPid)

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if (-not $seen.Add($current)) {
            continue
        }

        $ids.Add($current) | Out-Null

        $children = $all | Where-Object { $_.ParentProcessId -eq $current } | Select-Object -ExpandProperty ProcessId
        foreach ($child in $children) {
            $queue.Enqueue([int]$child)
        }
    }

    return $ids.ToArray()
}

function Stop-ProcessTree {
    param([int]$RootPid)

    $ids = Get-ProcessTreeIds -RootPid $RootPid | Sort-Object -Descending
    foreach ($procId in $ids) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
}

function Start-StandaloneServer {
    param(
        [string]$AppUrl,
        [string]$WorkingDirectory,
        [int]$TimeoutSec
    )

    $uri = [Uri]$AppUrl
    if (Test-AppReady -Uri $uri) {
        return $null
    }

    if (Test-PortListening -Uri $uri) {
        throw "Port $($uri.Port) is already in use, but $AppUrl is not responding as the local app. Pick another port or stop the conflicting process."
    }

    $port = if ($uri.Port -gt 0) { $uri.Port } else { 3000 }

    Remove-Item -LiteralPath $serverOutLog, $serverErrLog -Force -ErrorAction SilentlyContinue

    $proc = Start-Process `
        -FilePath "C:\Windows\System32\cmd.exe" `
        -ArgumentList "/d", "/s", "/c", "set PORT=$port&& npm.cmd run server" `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $serverOutLog `
        -RedirectStandardError $serverErrLog `
        -PassThru

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1

        if (Test-AppReady -Uri $uri) {
            return $proc.Id
        }

        if ($proc.HasExited) {
            break
        }
    }

    $outTail = if (Test-Path $serverOutLog) { (Get-Content $serverOutLog -Tail 40) -join [Environment]::NewLine } else { "" }
    $errTail = if (Test-Path $serverErrLog) { (Get-Content $serverErrLog -Tail 40) -join [Environment]::NewLine } else { "" }

    throw "Could not start local server at $AppUrl within ${TimeoutSec}s.`nSTDOUT:`n$outTail`nSTDERR:`n$errTail"
}

$argsList = @("--limit=$Limit", "--delayMs=$DelayMs")

if ($CooldownMs -ne $null) {
    $argsList += "--cooldownMs=$CooldownMs"
}

if ($Force.IsPresent) {
    $argsList += "--force=1"
}

if ($SyncMatches.IsPresent) {
    $argsList += "--syncMatches=1"
    $argsList += "--matchesCount=$MatchesCount"
}

Write-Host "Running local leaderboard cron against $LocalAppUrl" -ForegroundColor Cyan
Write-Host "Args: $($argsList -join ' ')" -ForegroundColor DarkGray

$serverRootPid = $null
$serverStartedHere = $false

Push-Location $repoRoot
try {
    $serverRootPid = Start-StandaloneServer -AppUrl $LocalAppUrl -WorkingDirectory $repoRoot -TimeoutSec $StartupTimeoutSec
    if ($serverRootPid) {
        $serverStartedHere = $true
        Write-Host "Started standalone local server at $LocalAppUrl (PID $serverRootPid)" -ForegroundColor Green
    } else {
        Write-Host "Using existing local server at $LocalAppUrl" -ForegroundColor DarkGray
    }

    $env:LOCAL_APP_URL = $LocalAppUrl
    & npm.cmd run refresh:leaderboard:local -- @argsList
}
finally {
    if ($serverStartedHere -and $serverRootPid) {
        Write-Host "Stopping standalone local server..." -ForegroundColor DarkGray
        Stop-ProcessTree -RootPid $serverRootPid
    }

    Remove-Item -LiteralPath $serverOutLog, $serverErrLog -Force -ErrorAction SilentlyContinue
    Pop-Location
}
