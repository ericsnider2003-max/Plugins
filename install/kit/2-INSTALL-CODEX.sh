#!/bin/sh
here="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then echo "Node.js not found. Install it from nodejs.org and run this again."; exit 1; fi
inst="$here/usage-max/codex/scripts/install.mjs"
if [ ! -f "$inst" ]; then
  inst=""
  for d in "$HOME"/.claude/plugins/cache/eric-plugins/usage-max/*; do [ -f "$d/codex/scripts/install.mjs" ] && inst="$d/codex/scripts/install.mjs"; done
fi
if [ -z "$inst" ]; then echo "Could not find usage-max. Extract the zip first."; exit 1; fi
node "$inst" || { echo "The Codex install did not finish - see the message above."; exit 1; }
echo
echo "NOW: remove the OLD usage-max from the Codex plugin list if present, then in the Codex CLI type /hooks and TRUST the usage-max hooks."
echo "Then run ./3-CHECK-EVERYTHING.sh"
