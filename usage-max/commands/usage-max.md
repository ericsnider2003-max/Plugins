---
description: Keep every AI plan lasting to reset — status, doctor, budget, gate, check, diagnose, audit, diet, rescue, balance, context, digest, savings, anomaly, offload, cap, trim, budgets, crosscheck, queue, memory, pack, resume, chat-prefs, enable-here, route, handoff, codex.
argument-hint: "[status|doctor|budget|gate|check|diagnose|audit|diet|rescue|balance|context|digest|savings|anomaly|offload|cap|trim|budgets|crosscheck|queue|memory <sub>|pack <goal>|resume|chat-prefs|enable-here|route <task>|handoff|codex <sub>]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-max.mjs":*)
---

# /usage-max

Output of the usage-max tool, already executed for you (no model calls, no network, nothing to approve):

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-max.mjs" $ARGUMENTS`

Relay it in a few lines. No argument = `status`. If it says the budget is uncalibrated, ask for the weekly % and reset time from Settings > Usage and run `/usage-max budget calibrate <pct> --resets "<date time>"`. Never pass `diet --disable` unless the user names the plugins. For `rescue apply`, show the diff first and only add `--write` after the user agrees. If the output above is an error and the argument was `route` or `handoff`, ignore the error: those two are done by you, as follows.

**route `<task>`**: classify with the `usage-max-routing` skill: Haiku `usage-max-scout` for search/read/web/format, Sonnet `usage-max-worker` for edits/tests/refactors, Opus 5.5 (yourself) for architecture/root-cause; micro-tasks stay inline; gate big changes with `usage-max-reviewer`; state the tier in one line first.

**handoff**: write/update `handoff.md` in the project root: goal and progress, key context (decisions, constraints, file pointers), remaining steps with the next one first, suggested tier. Then append one line to the task ledger (date, task, tier, outcome) and tell the user they can `/compact`, `/clear` or start fresh from it.
