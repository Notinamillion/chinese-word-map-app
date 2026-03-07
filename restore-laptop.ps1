# ============================================================
# Restore Chinese Word Map App to New Laptop
# Run this script in PowerShell on your Windows machine
# ============================================================

$InstallPath = "C:\Users\s.bateman\Programs"
$AppFolder   = "ChineseWordMapApp"
$FullPath    = Join-Path $InstallPath $AppFolder
$GitHubRepo  = "https://github.com/Notinamillion/chinese-word-map-app.git"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Chinese Word Map App - Laptop Restore Script" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Make sure the Programs folder exists -----------------
if (-not (Test-Path $InstallPath)) {
    Write-Host "[1/4] Creating $InstallPath ..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $InstallPath | Out-Null
} else {
    Write-Host "[1/4] Install path already exists: $InstallPath" -ForegroundColor Green
}

# --- 2. Check for git ----------------------------------------
Write-Host "[2/4] Checking for git ..." -ForegroundColor Yellow
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: git is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Download it from https://git-scm.com/download/win and re-run this script." -ForegroundColor Red
    exit 1
}
Write-Host "      git found: $(git --version)" -ForegroundColor Green

# --- 3. Clone or pull the repository -------------------------
if (Test-Path $FullPath) {
    Write-Host "[3/4] Folder already exists at $FullPath" -ForegroundColor Yellow
    Write-Host "      Pulling latest changes from GitHub ..." -ForegroundColor Yellow
    Set-Location $FullPath
    git pull origin main
} else {
    Write-Host "[3/4] Cloning repository to $FullPath ..." -ForegroundColor Yellow
    git clone $GitHubRepo $FullPath
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git clone/pull failed. Check your internet connection and try again." -ForegroundColor Red
    exit 1
}
Write-Host "      Repository ready at $FullPath" -ForegroundColor Green

# --- 4. Install Node dependencies ----------------------------
Write-Host "[4/4] Installing npm dependencies ..." -ForegroundColor Yellow
Set-Location $FullPath

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "WARNING: npm not found. Install Node.js from https://nodejs.org then run:" -ForegroundColor Yellow
    Write-Host "         cd `"$FullPath`"" -ForegroundColor White
    Write-Host "         npm install" -ForegroundColor White
} else {
    npm install
    if ($LASTEXITCODE -eq 0) {
        Write-Host "      npm install complete." -ForegroundColor Green
    } else {
        Write-Host "WARNING: npm install had errors. Try running 'npm install' manually." -ForegroundColor Yellow
    }
}

# --- Done ----------------------------------------------------
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Restore complete!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "App location : $FullPath" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Open PowerShell and cd to the app folder:" -ForegroundColor White
Write-Host "       cd `"$FullPath`"" -ForegroundColor Yellow
Write-Host "  2. Start the Expo development server:" -ForegroundColor White
Write-Host "       npm start" -ForegroundColor Yellow
Write-Host "  3. Scan the QR code with Expo Go on your phone" -ForegroundColor White
Write-Host ""
Write-Host "Server files are in: $FullPath\synology-scripts\" -ForegroundColor White
Write-Host "See README.md for full setup instructions." -ForegroundColor White
Write-Host ""
