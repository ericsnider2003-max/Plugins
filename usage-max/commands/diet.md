---
description: Plugin/context diet — measure what loads into every session (plugins, skills, CLAUDE.md, MCP) vs what you actually used; optionally disable unused plugins.
argument-hint: "[--days 30] [--disable plugin@market,...]"
---

# /diet

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/plugin-diet.mjs" $ARGUMENTS
```

Show the ranked output in a compact table and the advice lines. Never pass `--disable` unless the user names the plugins to turn off; disabling takes effect in NEW sessions only and is reversible (backup written). Mention that `/context` in a fresh session gives the true total.
