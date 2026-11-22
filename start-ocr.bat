@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 goto failed

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required. Install Node.js 24 LTS, then run this file again.
    goto failed
)

if not exist "node_modules\vite\package.json" (
    echo Installing dependencies for the first launch...
    call npm.cmd ci
    if errorlevel 1 goto failed
)

node scripts\prepare-models.js
if errorlevel 1 goto failed
node scripts\start-ocr.js
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo OCR could not start. See the message above.
pause
exit /b 1
