---
description: Keep every AI plan lasting to reset — status, doctor, budget, gate, check, diagnose, audit, diet, rescue, balance, enable-here, route, handoff, codex.
argument-hint: "[status|doctor|budget|gate|check|diagnose|audit|diet|rescue|balance|enable-here|route <task>|handoff|codex <sub>]"
---

# /usage-max

Run (no model calls, no network) and relay the result in a few lines:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-max.mjs" $ARGUMENTS
```

No argument = `status`. If it says the budget is uncalibrated, ask for the weekly % and reset time from Settings > Usage and run `budget calibrate <pct> --resets <date>`. Never pass `diet --disable` unless the user names the plugins. For `rescue apply`, show the diff first and only add `--write` after the user agrees.

**route `<task>`** (you do this, the script does not): classify with the `usage-max-routing` skill — Haiku `usage-max-scout` for search/read/web/format, Sonnet `usage-max-worker` for edits/tests/refactors, Opus 5.5 (yourself) for architecture/root-cause; micro-tasks stay inline; gate big changes with `usage-max-reviewer`; state the tier in one line first.

**handoff** (you do this): write/update `handoff.md` in the project root — goal and progress, key context (decisions, constraints, file pointers), remaining steps with the next one first, suggested tier — then append one line to the task ledger (date, task, tier, outcome) and tell the user they can `/compact`, `/clear` or start fresh from it.
