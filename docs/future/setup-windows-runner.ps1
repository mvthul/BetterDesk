# Setup Script for Windows 11 Proxmox Self-Hosted GitHub Runner (BetterDesk RDGen)
# Run this script as Administrator in PowerShell.

Write-Host "Starting Windows 11 Build Node Setup..." -ForegroundColor Cyan

# Ensure winget is available
if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
    Write-Host "Winget is not installed. Please install App Installer from the Microsoft Store or update Windows." -ForegroundColor Red
    exit 1
}

# 1. Install Git
Write-Host "Installing Git..." -ForegroundColor Yellow
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements

# 2. Install CMake
Write-Host "Installing CMake..." -ForegroundColor Yellow
winget install --id Kitware.CMake -e --source winget --accept-package-agreements --accept-source-agreements

# 3. Install Python 3
Write-Host "Installing Python 3..." -ForegroundColor Yellow
winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements

# 4. Install Visual Studio Build Tools 2022
# RustDesk requires MSVC (C++ build tools) and the Windows 10/11 SDK.
Write-Host "Installing Visual Studio Build Tools 2022 (C++ Desktop Development)..." -ForegroundColor Yellow
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" --source winget --accept-package-agreements --accept-source-agreements

# 5. Install Rust & Cargo (optional, but good to have natively available)
Write-Host "Installing Rust (rustup)..." -ForegroundColor Yellow
winget install --id Rustlang.Rustup -e --source winget --accept-package-agreements --accept-source-agreements

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Installation Complete! Please reboot the virtual machine." -ForegroundColor Green
Write-Host "After rebooting, you can download the GitHub Actions Runner from your repository settings and configure it." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
