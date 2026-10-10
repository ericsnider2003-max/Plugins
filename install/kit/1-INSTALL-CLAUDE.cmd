@echo off
setlocal
rem usage-max: install into the Claude Code TERMINAL app from GitHub (auto-updates). Safe to re-run. Needs only the claude CLI.
where claude >nul 2>nul
if errorlevel 1 goto noclaude
echo 1/3 adding the marketplace - pinned to main, auto-update on
call claude plugin marketplace add "ericsnider2003-max/Plugins#main"
call claude plugin marketplace update eric-plugins >nul 2>nul
echo 2/3 installing usage-max
call claude plugin install usage-max@eric-plugins
if errorlevel 1 goto failed
echo 3/3 turning off the older uploaded copy if you had one, so hooks do not run twice
call claude plugin disable usage-max@synced >nul 2>nul
echo.
echo DONE. Close Claude Code and open a NEW session. usage-max sets itself up on the first start.
echo Type /usage-max and pick usage-max:usage-max.
echo Next: 3-CHECK-EVERYTHING.cmd
pause
exit /b 0

:noclaude
echo The claude command was not found. This step is only for the Claude Code terminal app.
echo If you use the Claude desktop app, read START-HERE.txt part A instead.
pause
exit /b 1

:failed
echo.
echo The install did not finish - see the message above. Try:  claude plugin marketplace list
pause
exit /b 1
