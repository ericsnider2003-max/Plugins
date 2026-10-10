---
description: Run the zero-usage leak inventory — transcript audit plus live-session and scheduled-task inventory.
---

# /audit

Run both local inventory tools (no model calls, no network):

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/audit.mjs"
node "${CLAUDE_PLUGIN_ROOT}/scripts/inventory.mjs"
```

Report the top-burning sessions and projects, model shares, per-turn spikes, repeated-file/command signals, any live background sessions and loop/scheduled-task matches, and the explicit limitations (local transcripts only; loops and cloud rows verified in native `/usage` and the Routines/Cowork UIs).
