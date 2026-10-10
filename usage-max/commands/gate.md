---
description: Budget gate for batch/eval runs — exit 0/10/20 = green/amber/red; wrap claude -p with claude-lean.mjs to auto-downgrade or defer.
argument-hint: (none)
---

# /gate

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/governor.mjs" gate
```

Report the mode in one line. For automated eval/batch harnesses, tell the user to launch each run as `node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-lean.mjs" --hold-red -p ...` (defers in RED, downgrades the model to the mode's tier), or to check `governor.mjs gate` and skip when it exits 20.

Skip unchanged work in eval sweeps: `node "${CLAUDE_PLUGIN_ROOT}/scripts/eval-cache.mjs" --key <skill-dir>,<evals-dir> --artifacts <output-dir> --hold-red -- node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-lean.mjs" -p "..."` — a hit costs zero tokens; a miss runs once and is cached. `eval-cache.mjs status|clear` shows/reset savings.
