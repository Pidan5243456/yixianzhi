param([string]$AndroidSdk=$env:ANDROID_HOME,[string]$JavaHome='C:\Program Files\Java\jdk-21')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$version=(Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$relativeApk="artifacts/yixianzhi-$version-debug.apk"
$apk=Join-Path $taskRoot $relativeApk
$webRoot=Join-Path $taskRoot 'www'
$env:JAVA_HOME=$JavaHome
$buildTools=Join-Path $AndroidSdk 'build-tools/36.0.0'
$signature=& (Join-Path $buildTools 'apksigner.bat') verify --verbose $apk
if($LASTEXITCODE -ne 0) {throw 'APK signature verification failed'}
Push-Location $taskRoot
try { $badging=& (Join-Path $buildTools 'aapt.exe') dump badging $relativeApk }
finally { Pop-Location }
if($LASTEXITCODE -ne 0) {throw 'APK metadata inspection failed'}
$metadata=$badging -join "`n"
foreach($required in @("name='com.yixianzhi.app'","versionName='$version'","application-label:'衣先知'","sdkVersion:'24'","targetSdkVersion:'36'")) {
  if(-not $metadata.Contains($required)) {throw "Unexpected APK metadata: $required"}
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[System.IO.Compression.ZipFile]::OpenRead($apk)
$sha=[System.Security.Cryptography.SHA256]::Create()
$checked=0
try {
  $forbidden=@($zip.Entries | Where-Object {$_.FullName -match '^assets/public/(server/|node_modules/|tools/|design-reference/|\.tooling/|\.git/|admin\.html|\.env)'})
  if($forbidden.Count) {throw 'APK contains a private source path'}
  foreach($file in Get-ChildItem -LiteralPath $webRoot -File -Recurse) {
    $relative=$file.FullName.Substring($webRoot.Length+1).Replace('\','/')
    $entry=$zip.GetEntry('assets/public/'+$relative)
    if(-not $entry) {throw "APK missing resource: $relative"}
    $stream=$entry.Open()
    try {$actual=[Convert]::ToHexString($sha.ComputeHash($stream))} finally {$stream.Dispose()}
    $expected=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    if($actual -ne $expected) {throw "APK contains an outdated resource: $relative"}
    $checked++
  }
} finally {$zip.Dispose();$sha.Dispose()}
$result=[ordered]@{
  verifiedAt=(Get-Date).ToString('o')
  file=(Split-Path -Leaf $apk)
  sizeBytes=(Get-Item -LiteralPath $apk).Length
  sha256=(Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
  package='com.yixianzhi.app';label='衣先知';version=$version;minSdk=24;targetSdk=36
  signatureVerified=$true;matchingWebResources=$checked;privatePathsFound=0
  signatureOutput=($signature -join "`n")
}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'artifacts/apk-verification.json') -Encoding utf8
$result | ConvertTo-Json
