@echo off
setlocal
rem usage-max: tell it your Claude plan numbers once. Needed when you use the Claude desktop app or cloud sessions (no status line there).
where node >nul 2>nul
if errorlevel 1 goto nonode
set "CHK=%~dp0usage-max\scripts\usage-max.mjs"
if exist "%CHK%" goto ask
set "CHK="
set "CACHE=%USERPROFILE%\.claude\plugins\cache\eric-plugins\usage-max"
for /f "delims=" %%D in ('dir /b /ad /o-d "%CACHE%"') do if not defined CHK if exist "%CACHE%\%%D\scripts\usage-max.mjs" set "CHK=%CACHE%\%%D\scripts\usage-max.mjs"
if defined CHK goto ask
goto notfound

:ask
echo In Claude open Settings, then Usage. Read the weekly percent and the reset time.
echo.
set "PCT="
set "RST="
set /p PCT=Weekly percent used, for example 67: 
set /p RST=Reset date and time, for example Oct 11 2026 11:00 AM: 
if not defined PCT goto bad
if not defined RST goto bad
node "%CHK%" budget calibrate %PCT% --resets "%RST%"
echo.
echo Done. Run this again whenever you look at Settings, Usage. Two readings a few hours apart give a real burn rate.
pause
exit /b 0

:bad
echo You need to type both numbers. Run this again.
pause
exit /b 1

:nonode
echo Node.js was not found. Install Node.js from nodejs.org, then run this again.
pause
exit /b 1

:notfound
echo Could not find the usage-max files. Extract the zip first, then run this from the extracted folder.
pause
exit /b 1
