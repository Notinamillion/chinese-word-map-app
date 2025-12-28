# Trigger EAS Build with workarounds for Windows path issues
# This script sets environment variables to avoid path problems

Write-Host "Triggering EAS Build for Chinese Word Map..." -ForegroundColor Green
Write-Host ""

# Set safe temp directories
$env:TEMP = "$env:USERPROFILE\AppData\Local\Temp"
$env:TMP = "$env:USERPROFILE\AppData\Local\Temp"
$env:TMPDIR = "$env:USERPROFILE\AppData\Local\Temp"

# Disable prompts
$env:EXPO_NO_PROMPT = "1"
$env:EAS_NO_PROMPT = "1"
$env:CI = "1"

Set-Location "C:\Users\s.bateman\ChineseWordMapApp"

Write-Host "Project ID: c6648226-8c45-45d9-a046-2efe0c94e261" -ForegroundColor Cyan
Write-Host "Build Profile: preview (APK)" -ForegroundColor Cyan
Write-Host ""

Write-Host "Attempting to start build on EAS servers..." -ForegroundColor Yellow
Write-Host ""

# Try the build
eas build --platform android --profile preview --non-interactive --no-wait

Write-Host ""
Write-Host "If the build started successfully, check status at:" -ForegroundColor Green
Write-Host "https://expo.dev/accounts/nowaymr/projects/chinesewordappmap/builds" -ForegroundColor Cyan
Write-Host ""
Write-Host "Or run: eas build:list" -ForegroundColor Yellow
