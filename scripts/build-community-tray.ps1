param(
  [string]$Configuration = "Release"
)

& (Join-Path $PSScriptRoot "build-tray.ps1") -Mode community -Configuration $Configuration
