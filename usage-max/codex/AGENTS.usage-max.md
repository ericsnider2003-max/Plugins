<!-- usage-max:start -->
## usage-max (routing)
- Send each step to the cheapest capable lane: light for search, reading and formatting; standard for edits and tests; the strongest only for architecture, ambiguous debugging and final review.
- When `node <usage-max>/scripts/codex-governor.mjs status` shows GREEN with SURPLUS, spend the surplus on the strongest lane for hard work.
- At RED/AMBER, RECOMMEND a cheaper lane or deferring non-urgent work, and say why. Do not switch accounts or models yourself.
- Respect the budget gate (`codex-governor.mjs gate`: exit 10 = AMBER, 20 = RED) for batch, CI and evaluation runs.
- Say when you used a cheaper lane. If it shows signs of failing (wrong output, failing tests, repeated errors), escalate one lane and say so.
- Never silently downgrade a model the user explicitly requested.
- Never stop or shorten authorized work silently; if blocked, say what blocks it.
- Report usage as measured or estimate. Never invent allowance data; if it is missing or stale, say it is unavailable.
<!-- usage-max:end -->
