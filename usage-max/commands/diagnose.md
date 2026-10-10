---
description: Find where plan usage goes and rank the levers (cache TTL, startup context, output, context size) from local transcripts.
argument-hint:
- --days N
---

# /diagnose

Run the local analyzer (no model calls, no network):

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/diagnose.mjs" $ARGUMENTS
```

Report the ranked levers with their estimated savings, the cost breakdown (cache reads / writes / output), the main-session context distribution, the startup-context median, and the projects where a 5-minute cache is cheaper. Costs are list-price estimates used as a proxy for plan usage (Anthropic does not publish the per-token plan formula). Recommend only levers whose estimated saving is material, and say which ones change behavior (plugins, bare mode) versus billing only (cache TTL).
