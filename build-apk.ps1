# Build Android APK using EAS Build
# Run this script in PowerShell

Write-Host "Building Chinese Word Map Android APK..." -ForegroundColor Green
Write-Host ""

# Set environment to avoid path issues
$env:TEMP = $env:LOCALAPPDATA + "\Temp"
$env:TMP = $env:LOCALAPPDATA + "\Temp"

# Navigate to app directory
Set-Location -Path "C:\Users\s.bateman\ChineseWordMapApp"

Write-Host "Checking EAS login status..." -ForegroundColor Yellow
eas whoami

Write-Host ""
Write-Host "Starting build process..." -ForegroundColor Yellow
Write-Host "This will build the APK on Expo's servers (cloud build)"
Write-Host ""

# Run the build command
eas build --platform android --profile preview

Write-Host ""
Write-Host "Build complete! Check the output above for the download link." -ForegroundColor Green
Write-Host ""
