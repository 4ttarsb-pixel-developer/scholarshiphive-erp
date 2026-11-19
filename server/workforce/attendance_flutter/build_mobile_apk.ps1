# Builds the Android APK against the unified Workforce ERP backend.
# Usage:  .\build_mobile_apk.ps1 -BackendUrl http://192.168.1.50:4000
#         .\build_mobile_apk.ps1 -BackendUrl https://erp.yourcompany.com
param(
  [Parameter(Mandatory = $true)][string]$BackendUrl
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if ($BackendUrl.TrimEnd('/') -match '/api$') { throw "Do not include /api in BackendUrl." }
Write-Host "Building Android APK against $BackendUrl ..." -ForegroundColor Cyan
flutter pub get
flutter build apk --release --dart-define=API_BASE_URL=$BackendUrl
Write-Host "APK: build\app\outputs\flutter-apk\app-release.apk" -ForegroundColor Green
