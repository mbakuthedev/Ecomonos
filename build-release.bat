@echo off
REM Build script for Economos - creates installers for Windows

echo Building Economos installers...
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

REM Build for Windows
echo Building for Windows...
call npm run build:win

REM Build for macOS (if on macOS)
if "%OS%"=="Darwin" (
    echo Building for macOS...
    call npm run build:mac
)

REM Build for Linux (if on Linux)
if "%OS%"=="Linux" (
    echo Building for Linux...
    call npm run build:linux
)

echo.
echo Build complete!
echo.
echo Installers created in dist\ folder:
dir /b dist\*.exe dist\*.dmg dist\*.AppImage 2>nul
echo.
echo Next steps:
echo   1. Test the installer
echo   2. Upload to GitHub Releases or your website
echo   3. Share the download link with users
echo.

pause
