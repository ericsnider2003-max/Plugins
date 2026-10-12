@echo off
setlocal
rem usage-max: applies the safe profile (never overwrites your own settings) then checks Claude and Codex.
where node >nul 2>nul
if errorlevel 1 goto nonode
set "CHK=%~dp0usage-max\scripts\usage-max.mjs"
if exist "%CHK%" goto run
set "CHK="
set "CACHE=%USERPROFILE%\.claude\plugins\cache\eric-plugins\usage-max"
for /f "delims=" %%D in ('dir /b /ad /o-d "%CACHE%"') do if not defined CHK if exist "%CACHE%\%%D\scripts\usage-max.mjs" set "CHK=%CACHE%\%%D\scripts\usage-max.mjs"
if defined CHK goto run
goto notfound

:run
node "%CHK%" doctor --fix
echo.
echo Lines starting with FIX tell you exactly what to do. Lines starting with ok are fine.
pause
exit /b 0

:nonode
echo Node.js was not found. Install Node.js from nodejs.org, then run this again.
pause
exit /b 1

:notfound
echo Could not find the usage-max files.
echo If you opened this from INSIDE the zip file: close this window, right-click the zip,
echo choose Extract All, open the extracted folder, and run this file from there.
pause
exit /b 1
