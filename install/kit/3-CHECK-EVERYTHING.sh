#!/bin/sh
here="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then echo "Node.js not found. Install it from nodejs.org and run this again."; exit 1; fi
chk="$here/usage-max/scripts/usage-max.mjs"
if [ ! -f "$chk" ]; then
  chk=""
  for d in "$HOME"/.claude/plugins/cache/eric-plugins/usage-max/*; do [ -f "$d/scripts/usage-max.mjs" ] && chk="$d/scripts/usage-max.mjs"; done
fi
if [ -z "$chk" ]; then echo "Could not find usage-max. Extract the zip first."; exit 1; fi
node "$chk" doctor --fix
echo
echo 'Lines starting with FIX tell you exactly what to do. Lines starting with ok are fine.'
