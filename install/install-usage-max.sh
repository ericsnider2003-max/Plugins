#!/bin/sh
# One-step installer for usage-max (Claude Code). Safe to re-run. Needs only the `claude` CLI.
set -u
if ! command -v claude >/dev/null 2>&1; then echo "claude CLI not found on PATH. Install Claude Code first."; exit 1; fi
echo "1/3 adding the marketplace (pinned to main, auto-update on)..."
claude plugin marketplace add "ericsnider2003-max/Plugins#main" || echo "   (already added, or see the message above)"
claude plugin marketplace update eric-plugins >/dev/null 2>&1
echo "2/3 installing usage-max..."
claude plugin install usage-max@eric-plugins || { echo "install failed; run: claude plugin marketplace list"; exit 1; }
echo "3/3 turning off the older uploaded copy (if you had one), so hooks do not run twice..."
claude plugin disable usage-max@synced >/dev/null 2>&1 && echo "   any older uploaded copy is now off" || echo "   nothing to turn off"
cat <<'MSG'

Done. Start a NEW Claude Code session: usage-max configures itself on the first start
(settings, status line, budget) and keeps itself updated. Check anytime with:  /usage-max doctor

Codex (optional): node "<this plugin folder>/codex/scripts/install.mjs"   then in Codex run /hooks and trust the usage-max hooks.
Find the folder with:  claude plugin details usage-max
MSG
