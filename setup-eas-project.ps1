# Setup EAS Project for Chinese Word Map App
# This script works around Windows path issues with EAS CLI

Write-Host "Setting up EAS project for Chinese Word Map..." -ForegroundColor Green
Write-Host ""

# Set safer temp directory
$env:TEMP = "$env:USERPROFILE\AppData\Local\Temp"
$env:TMP = "$env:USERPROFILE\AppData\Local\Temp"

Set-Location "C:\Users\s.bateman\ChineseWordMapApp"

Write-Host "Current user:" -ForegroundColor Yellow
eas whoami
Write-Host ""

Write-Host "Attempting to initialize EAS project..." -ForegroundColor Yellow
Write-Host "If this fails, we'll need to use the Expo website instead." -ForegroundColor Yellow
Write-Host ""

# Try to create project
try {
    # This will prompt for input
    eas build:configure
} catch {
    Write-Host ""
    Write-Host "ERROR: EAS CLI has Windows compatibility issues" -ForegroundColor Red
    Write-Host ""
    Write-Host "SOLUTION: Create project via Expo website instead:" -ForegroundColor Yellow
    Write-Host "1. Go to https://expo.dev" -ForegroundColor Cyan
    Write-Host "2. Log in as 'nowaymr'" -ForegroundColor Cyan
    Write-Host "3. Click 'Create a project' or '+' button" -ForegroundColor Cyan
    Write-Host "4. Enter project name: ChineseWordMapApp" -ForegroundColor Cyan
    Write-Host "5. Copy the Project ID shown" -ForegroundColor Cyan
    Write-Host "6. Add to app.json under 'extra.eas.projectId'" -ForegroundColor Cyan
    Write-Host ""
}

Write-Host "Done!" -ForegroundColor Green
