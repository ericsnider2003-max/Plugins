@echo off
setlocal
rem usage-max: install the Codex side. Needs Node.js. Finds usage-max next to this file, or in the copy Claude installed.
where node >nul 2>nul
if errorlevel 1 goto nonode
set "INST=%~dp0usage-max\codex\scripts\install.mjs"
if exist "%INST%" goto run
set "INST="
set "CACHE=%USERPROFILE%\.claude\plugins\cache\eric-plugins\usage-max"
for /f "delims=" %%D in ('dir /b /ad /o-d "%CACHE%"') do if not defined INST if exist "%CACHE%\%%D\codex\scripts\install.mjs" set "INST=%CACHE%\%%D\codex\scripts\install.mjs"
if defined INST goto run
goto notfound

:run
node "%INST%"
if errorlevel 1 goto failed
echo.
echo DONE with the Codex install.
echo NOW: remove the OLD usage-max from the Codex plugin list if it is there.
echo THEN: in the Codex CLI type  /hooks  and TRUST the usage-max hooks. The app cannot open /hooks, the trust is shared.
echo Then run 3-CHECK-EVERYTHING.cmd to confirm.
pause
exit /b 0

:nonode
echo Node.js was not found. Install Node.js from nodejs.org, then run this again.
pause
exit /b 1

:notfound
echo Could not find the usage-max files.
echo.
echo If you opened this from INSIDE the zip file: close this window, right-click the zip,
echo choose Extract All, open the extracted folder, and run this file from there.
pause
exit /b 1

:failed
echo.
echo The Codex install did not finish - see the message above. Nothing was claimed as done.
pause
exit /b 1
