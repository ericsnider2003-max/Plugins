@echo off
setlocal
title usage-max - doing everything, please wait
rem usage-max: ONE double-click. Fixes what it safely can, runs every check, saves one report on your Desktop. Nothing here needs typing.
where node >nul 2>nul
if errorlevel 1 goto nonode
set "CHK=%~dp0usage-max\scripts\usage-max.mjs"
if exist "%CHK%" goto found
set "CHK="
for /d %%D in ("%USERPROFILE%\.claude\plugins\cache\eric-plugins\usage-max\*") do if exist "%%D\scripts\usage-max.mjs" set "CHK=%%D\scripts\usage-max.mjs"
if defined CHK goto found
goto notfound

:found
set "REPORT=%USERPROFILE%\Desktop\usage-max-report.txt"
if not exist "%USERPROFILE%\Desktop" set "REPORT=%USERPROFILE%\usage-max-report.txt"
set "BIN=%USERPROFILE%\.usage-max-codex\bin"
echo This takes about a minute. Please do not close this window.
echo usage-max report, made %DATE% %TIME% > "%REPORT%"
echo. >> "%REPORT%"

echo [1 of 6] Checking and fixing Claude and Codex setup...
echo ===== 1. SETUP CHECK AND SAFE FIXES ===== >> "%REPORT%"
node "%CHK%" doctor --fix >> "%REPORT%" 2>&1

echo [2 of 6] Turning on Codex output trimming test...
echo. >> "%REPORT%"
echo ===== 2. CODEX TRIM TEST ===== >> "%REPORT%"
if exist "%BIN%\scripts\codex-governor.mjs" (node "%BIN%\scripts\codex-governor.mjs" selftest-trim >> "%REPORT%" 2>&1) else (echo Codex scripts not installed yet. Run 2-INSTALL-CODEX first. >> "%REPORT%")

echo [3 of 6] Finding where your Codex usage goes...
echo. >> "%REPORT%"
echo ===== 3. WHERE CODEX USAGE WENT, LAST 14 DAYS ===== >> "%REPORT%"
node "%CHK%" codex diagnose --days 14 >> "%REPORT%" 2>&1

echo [4 of 6] Checking for runaway usage...
echo. >> "%REPORT%"
echo ===== 4. IS ANYTHING BURNING TOO FAST ===== >> "%REPORT%"
node "%CHK%" anomaly >> "%REPORT%" 2>&1

echo [5 of 6] Working out what usage-max saved...
echo. >> "%REPORT%"
echo ===== 5. WHAT USAGE-MAX SAVED, LAST 14 DAYS ===== >> "%REPORT%"
node "%CHK%" savings --days 14 >> "%REPORT%" 2>&1

echo [6 of 6] Learning how expensive each Codex model is...
echo. >> "%REPORT%"
echo ===== 6. CODEX MODEL COSTS LEARNED FROM YOUR LOGS ===== >> "%REPORT%"
node "%CHK%" codex weights >> "%REPORT%" 2>&1

echo. >> "%REPORT%"
echo ===== END OF REPORT ===== >> "%REPORT%"
echo.
echo ALL DONE.
echo The report is saved on your Desktop as:  usage-max-report.txt
echo It will open now. Send that file (or paste its text) to Claude and say: "here is my report, fix what is wrong".
echo It lists folder names from your work, and no passwords or file contents. Look it over if you like.
start notepad "%REPORT%"
pause
exit /b 0

:nonode
echo Node.js was not found on this PC. Install it from nodejs.org (the big green button), then double-click this file again.
pause
exit /b 1

:notfound
echo Could not find the usage-max files.
echo If you opened this from INSIDE the zip file: close this window, right-click the zip,
echo choose Extract All, open the extracted folder, and double-click this file from there.
pause
exit /b 1
