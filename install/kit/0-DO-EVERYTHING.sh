#!/bin/sh
# usage-max: ONE run (macOS / Linux). Installs what is missing, applies the safe fixes, runs every check, saves one report on your Desktop.
here="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then echo "Node.js was not found. Install it from nodejs.org (the big green button), then run this again."; exit 1; fi
chk="$here/usage-max/scripts/usage-max.mjs"
if [ ! -f "$chk" ]; then
  chk=""
  for d in "$HOME"/.claude/plugins/cache/eric-plugins/usage-max/*; do [ -f "$d/scripts/usage-max.mjs" ] && chk="$d/scripts/usage-max.mjs"; done
fi
if [ -z "$chk" ]; then echo "Could not find the usage-max files. Extract the zip first, then run this from the extracted folder."; exit 1; fi
report="$HOME/Desktop/usage-max-report.txt"; [ -d "$HOME/Desktop" ] || report="$HOME/usage-max-report.txt"
bin="$HOME/.usage-max-codex/bin"; cinst="$(dirname "$chk")/../codex/scripts/install.mjs"
echo "This takes about a minute. Please do not close this window."
{ echo "usage-max report, made $(date)"; echo; echo "===== 0. INSTALL WHAT IS MISSING ====="; } > "$report"
if command -v claude >/dev/null 2>&1 && [ ! -d "$HOME/.claude/plugins/cache/eric-plugins/usage-max" ]; then
  echo "[setup] Installing usage-max into Claude Code..."
  { claude plugin marketplace add "ericsnider2003-max/Plugins#main"; claude plugin install usage-max@eric-plugins; claude plugin disable usage-max@synced >/dev/null 2>&1; echo "Claude Code install done. Open a NEW Claude Code session to use it."; } >> "$report" 2>&1
fi
if [ -d "$HOME/.codex" ] && [ ! -f "$bin/VERSION" ] && [ -f "$cinst" ]; then
  echo "[setup] Installing the Codex side..."
  { node "$cinst"; echo "Codex install done."; } >> "$report" 2>&1
fi
echo "Nothing else to install." >> "$report"
step() { echo "[$1 of 6] $2"; { echo; echo "===== $1. $3 ====="; } >> "$report"; }
step 1 "Checking and fixing Claude and Codex setup..." "SETUP CHECK AND SAFE FIXES"; node "$chk" doctor --fix >> "$report" 2>&1
step 2 "Codex output trimming test..." "CODEX TRIM TEST"
if [ -f "$bin/scripts/codex-governor.mjs" ]; then node "$bin/scripts/codex-governor.mjs" selftest-trim >> "$report" 2>&1; else echo "Codex scripts not installed (Codex not found on this computer)." >> "$report"; fi
step 3 "Finding where your Codex usage goes..." "WHERE CODEX USAGE WENT, LAST 14 DAYS"; node "$chk" codex diagnose --days 14 >> "$report" 2>&1
step 4 "Checking for runaway usage..." "IS ANYTHING BURNING TOO FAST"; node "$chk" anomaly >> "$report" 2>&1
step 5 "Working out what usage-max saved..." "WHAT USAGE-MAX SAVED, LAST 14 DAYS"; node "$chk" savings --days 14 >> "$report" 2>&1
step 6 "Learning how expensive each Codex model is..." "CODEX MODEL COSTS LEARNED FROM YOUR LOGS"; node "$chk" codex weights >> "$report" 2>&1
printf '\n===== END OF REPORT =====\n' >> "$report"
echo; echo "ALL DONE. The report is saved as: $report"
echo 'Send that file (or paste its text) to Claude and say: "here is my report, fix what is wrong".'
echo "It lists folder names from your work, and no passwords or file contents."
if command -v open >/dev/null 2>&1; then open "$report"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$report" >/dev/null 2>&1; fi
