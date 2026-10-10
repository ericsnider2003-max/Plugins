---
name: usage-max
description: Check and manage the ChatGPT/Codex plan budget (weekly cap) — status, calibrate from /status, switch mode, gate batch jobs. Use when the user mentions usage, limits, running out, budget, or before large autonomous jobs.
---
# usage-max (Codex)
Run from the plugin folder (`<usage-max>` = where it was installed/unzipped):
- `node <usage-max>/scripts/codex-governor.mjs status` — mode, est. plan %, burn vs sustainable.
- `... calibrate <pct> --resets <ISO>` — pct from `/status` or chatgpt.com/codex/settings/usage; resets time with offset (e.g. 2026-10-11T11:00:00-07:00). Re-calibrate every few days; accuracy improves each time.
- `... mode auto|green|amber|red` — manual override. New sessions pick up model/effort; a running session needs `/model`.
- `... gate` — exit 0/10/20 (green/amber/red) for scripts. `codex-lean.mjs --hold-red <args>` launches codex on the right profile or defers in RED.
Policy: GREEN normal; AMBER low effort + smaller scope; RED cheapest model, no big autonomous jobs. Never claim exact % — it is an estimate until calibrated.
