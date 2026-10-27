# usage-max for ChatGPT (web/app) — paste-in version
ChatGPT has no hooks or local files, so nothing can be automated there; this is the manual governor.

## Paste into Settings > Personalization > Custom instructions ("How would you like ChatGPT to respond?")
Usage-max is observation-only during authorized interactive work. Continue the task until it is complete or genuinely blocked. Do not ask permission for long work, shorten the work window, or recommend a fresh chat because of usage limits. Use budget controls only for explicitly requested batch, CI, or evaluation runs.

## Reasoning/model policy (the Instant/Thinking picker was replaced by a thinking-effort slider in Aug 2026; names vary by plan)
- Slider: keep Low; Medium/High/Extra High draw Thinking limits; Pro models have a separate allowance.
- Default: the cheapest/light model (e.g. Luna class). It has ~70x the message allowance of the top model on Plus.
- Step up one tier only when the cheap one fails or the task is hard. Top tier (Astra class) and Fast/Ultrafast modes: rarely.
- Fast mode costs 2.5x included limits; Ultrafast 8x. Image generation burns 3-5x faster.

## Weekly routine
1. Sunday (or your reset): note reset time at chatgpt.com/codex/settings/usage.
2. Each morning: check usage %. Target: ≤ (days elapsed / 7) × 100 + 5.
3. Ahead of pace -> switch default one tier down, turn off connectors you don't use (each adds context to every message), start fresh threads.
4. Codex and ChatGPT local/cloud tasks share one pool: heavy Codex runs eat chat allowance.

## Projects
Use one Project per area with short instructions; avoid attaching big files to every chat (they re-enter context).
