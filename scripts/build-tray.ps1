param(
  [ValidateSet("host", "community", "all")]
  [string]$Mode = "host",
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$agentRoot = Join-Path $repoRoot "local-refresh-agent"
$projectPath = Join-Path $agentRoot "src\RiftBoardRefreshTray\RiftBoardRefreshTray.csproj"
$publishDir = Join-Path $agentRoot "publish"
$resolvedAgentRoot = (Resolve-Path $agentRoot).Path

function Remove-AgentPath {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return
  }

  $resolvedPath = (Resolve-Path $Path).Path
  if (-not $resolvedPath.StartsWith($resolvedAgentRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside local-refresh-agent: $resolvedPath"
  }

  Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Publish-Tray {
  Remove-AgentPath $publishDir

  dotnet publish $projectPath `
    --configuration $Configuration `
    --runtime win-x64 `
    --self-contained true `
    --output $publishDir `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true
}

function New-TrayPackage {
  param(
    [ValidateSet("host", "community")]
    [string]$PackageMode
  )

  $packageDirName = if ($PackageMode -eq "host") { "host-share" } else { "community-share" }
  $zipName = if ($PackageMode -eq "host") { "RiftBoardRefreshTray-host.zip" } else { "RiftBoardRefreshTray-community.zip" }
  $configSource = if ($PackageMode -eq "host") { Join-Path $agentRoot "config.json" } else { Join-Path $agentRoot "community-config.example.json" }
  $packageDir = Join-Path $agentRoot $packageDirName
  $zipPath = Join-Path $agentRoot $zipName

  if (-not (Test-Path $configSource)) {
    throw "Missing config source for ${PackageMode} package: $configSource"
  }

  Remove-AgentPath $packageDir
  Remove-AgentPath $zipPath

  New-Item -ItemType Directory -Path $packageDir | Out-Null
  Copy-Item -Path (Join-Path $publishDir "*") -Destination $packageDir -Recurse
  Copy-Item -Path $configSource -Destination (Join-Path $packageDir "config.json") -Force
  Copy-Item -Path (Join-Path $agentRoot "README.md") -Destination (Join-Path $packageDir "README.md") -Force
  if (Test-Path (Join-Path $agentRoot "app-icon.ico")) {
    Copy-Item -Path (Join-Path $agentRoot "app-icon.ico") -Destination (Join-Path $packageDir "app-icon.ico") -Force
  }

  Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force

  Write-Host "Built self-contained $PackageMode tray package:"
  Write-Host "  $packageDir"
  Write-Host "  $zipPath"
}

function Update-RootHostPackage {
  $hostDir = Join-Path $agentRoot "host-share"
  if (-not (Test-Path $hostDir)) {
    throw "Host package directory was not built: $hostDir"
  }

  foreach ($staleFileName in @(
    "RiftBoardRefreshTray.dll",
    "RiftBoardRefreshTray.deps.json",
    "RiftBoardRefreshTray.runtimeconfig.json"
  )) {
    Remove-AgentPath (Join-Path $agentRoot $staleFileName)
  }

  foreach ($fileName in @(
    "RiftBoardRefreshTray.exe",
    "RiftBoardRefreshTray.pdb"
  )) {
    $source = Join-Path $hostDir $fileName
    if (Test-Path $source) {
      Copy-Item -Path $source -Destination (Join-Path $agentRoot $fileName) -Force
    }
  }

  Copy-Item -Path (Join-Path $hostDir "config.json") -Destination (Join-Path $agentRoot "config.json") -Force
  Write-Host "Updated root host tray executable:"
  Write-Host "  $(Join-Path $agentRoot "RiftBoardRefreshTray.exe")"
}

Publish-Tray

if ($Mode -eq "all") {
  New-TrayPackage "host"
  New-TrayPackage "community"
  Update-RootHostPackage
} else {
  New-TrayPackage $Mode
  if ($Mode -eq "host") {
    Update-RootHostPackage
  }
}
