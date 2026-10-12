#!/bin/sh
here="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then echo "Node.js not found."; exit 1; fi
chk="$here/usage-max/scripts/usage-max.mjs"
[ -f "$chk" ] || { chk=""; for d in $(ls -td "$HOME"/.claude/plugins/cache/eric-plugins/usage-max/*/ 2>/dev/null); do [ -z "$chk" ] && [ -f "${d}scripts/usage-max.mjs" ] && chk="${d}scripts/usage-max.mjs"; done; }
[ -n "$chk" ] || { echo "Could not find usage-max. Extract the zip first."; exit 1; }
echo "In Claude open Settings, then Usage. Read the weekly percent and the reset time."
printf "Weekly percent used, for example 67: "; read pct
printf "Reset date and time, for example Oct 11 2026 11:00 AM: "; read rst
node "$chk" budget calibrate "$pct" --resets "$rst"
