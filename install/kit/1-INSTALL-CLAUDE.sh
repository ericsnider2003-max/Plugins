#!/bin/sh
if ! command -v claude >/dev/null 2>&1; then echo "claude CLI not found. This step is only for the Claude Code terminal app (see START-HERE.txt part A for the desktop app)."; exit 1; fi
echo "1/3 adding the marketplace (pinned to main, auto-update on)..."
claude plugin marketplace add "ericsnider2003-max/Plugins#main" || echo "   (already added, or see the message above)"
claude plugin marketplace update eric-plugins >/dev/null 2>&1
echo "2/3 installing usage-max..."
claude plugin install usage-max@eric-plugins || { echo "Install failed. Run: claude plugin marketplace list"; exit 1; }
echo "3/3 turning off the older uploaded copy (if you had one)..."
claude plugin disable usage-max@synced >/dev/null 2>&1
echo
echo "DONE. Open a NEW Claude Code session, type /usage-max and pick usage-max:usage-max."
echo "Next: ./3-CHECK-EVERYTHING.sh"
