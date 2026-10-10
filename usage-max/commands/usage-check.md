---
description: Report token burn by model, pacing vs the weekly budget, and Opus-turn compliance from local transcripts.
---

# /usage-check

Run the local checker and interpret the result:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-check.mjs" --write-status "$HOME/.claude/usage-max/status.json"
```

Report: tokens by model this week, Opus share, 5-hour vs weekly burn, burn/day vs the ≤14%-per-day checkpoint, per-turn spikes, ceiling compliance (nothing above Opus 5.5, no fable) and subagent routing (sidechain turns on Haiku/Sonnet only). If asked, add `--weekly-used-percent <n>` from Settings > Usage for cap-day projection. Remind the user this covers local Claude Code transcripts only — subtract the local total from the Settings > Usage weekly percent for the Cowork/chat share.
