@echo off
rem One-step installer for usage-max (Claude Code). Safe to re-run. Needs only the claude CLI.
where claude >nul 2>nul
if errorlevel 1 (
  echo claude CLI not found on PATH. Install Claude Code first.
  pause
  exit /b 1
)
echo 1/3 adding the marketplace (pinned to main, auto-update on)...
call claude plugin marketplace add "ericsnider2003-max/Plugins#main"
call claude plugin marketplace update eric-plugins >nul 2>nul
echo 2/3 installing usage-max...
call claude plugin install usage-max@eric-plugins
if errorlevel 1 (
  echo install failed; run: claude plugin marketplace list
  pause
  exit /b 1
)
echo 3/3 turning off the older uploaded copy (if you had one), so hooks do not run twice...
call claude plugin disable usage-max@synced >nul 2>nul
echo.
echo Done. Start a NEW Claude Code session: usage-max configures itself on the first start
echo (settings, status line, budget) and keeps itself updated. Check anytime with:  /usage-max doctor
echo.
echo Codex (optional): node "^<this plugin folder^>\codex\scripts\install.mjs"  then in Codex run /hooks and trust the usage-max hooks.
echo Find the folder with:  claude plugin details usage-max
pause
