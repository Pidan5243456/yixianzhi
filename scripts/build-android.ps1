param([string]$JavaHome = 'C:\Program Files\Java\jdk-21', [string]$AndroidSdk = $env:ANDROID_HOME)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
if (-not $AndroidSdk) { throw '请通过 -AndroidSdk 指定 Android SDK 目录（API 36 / build-tools 36）。' }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidSdk
$env:ANDROID_SDK_ROOT = $AndroidSdk
$env:ANDROID_USER_HOME = Join-Path $taskRoot '.tooling/android-user'
$env:GRADLE_USER_HOME = Join-Path $taskRoot '.tooling/gradle'
Push-Location $taskRoot
try {
  node scripts/build-web.cjs
  if ($LASTEXITCODE -ne 0) { throw '网页资源构建失败' }
  node node_modules/@capacitor/cli/bin/capacitor sync android
  if ($LASTEXITCODE -ne 0) { throw 'Android 同步失败' }
  Push-Location android
  try { .\gradlew.bat --no-daemon assembleDebug; if ($LASTEXITCODE -ne 0) { throw 'APK 构建失败' } } finally { Pop-Location }
  New-Item -ItemType Directory -Path artifacts -Force | Out-Null
  Copy-Item -LiteralPath android/app/build/outputs/apk/debug/app-debug.apk -Destination "artifacts/yixianzhi-$version-debug.apk" -Force
  Get-FileHash -Algorithm SHA256 "artifacts/yixianzhi-$version-debug.apk"
} finally { Pop-Location }
