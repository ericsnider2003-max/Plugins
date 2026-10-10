---
name: usage-max-routing
description: Triage every task to the smallest capable model tier and escalate on evidence. Use for any multi-step task before delegating.
---

# Model routing

Ceiling: Opus 5.5. Never use fable or best.

## Triage rubric

- **Haiku** (`usage-max-scout`): search, file reads, web checks, formatting, boilerplate, single screenshots, output summaries.
- **Sonnet** (`usage-max-worker`): standard edits, tests, refactors, reviews via `usage-max-reviewer`.
- **Opus 5.5** (the hub itself): planning, architecture decisions, root-cause deadlocks, ambiguous plans, final synthesis. The hub runs on Opus 5.5; it delegates volume work down, it never escalates above Opus 5.5.

## Micro-task threshold

If the whole job is one small read or one-line answer, do it inline. Never pay a subagent dispatch for less than a subagent's worth of work.

## Hub discipline

- One hub session per project. Compact at task boundaries, `/clear` only between projects.
- Exploration never accumulates in the hub: scouts work in sidechains and return structured summaries (findings, file paths with line ranges, open questions).
- Sequential by default. Parallel only when the payload exceeds the overhead, at most 2 workers, never recursive.
- Verify by running: cheapest local check first (`cargo check`, `pytest -q`, `tsc --noEmit`, `vitest`, `eslint`) instead of extended reasoning.

## Handoff boundaries

Every ~20 messages or at a task boundary, write `handoff.md` (goal, key context, decisions, checklist, next step) plus a task ledger entry. A fresh session can resume from the handoff file with a smaller, warmer context.

## Escalation protocol

- `NEEDS_SONNET` / `NEEDS_OPUS` + concrete reason + failure history; one retry per tier, max two failed attempts, then stop and surface to the human.
- Subagent (sidechain) turns must stay on Haiku/Sonnet; `usage-check` flags any sidechain Opus turn and any model above the Opus 5.5 ceiling.

## Maximize the plan

The goal is the most finished work per week: no waste, and no unused allowance at reset.

- Read the status line pace. `⚠ cap in …` means slow down: route more work to Haiku/Sonnet subagents, keep effort at medium, batch questions into fewer turns. `spend more` means headroom will be lost at reset: it is fine to use `/effort high` on hard problems or queue extra work.
- Every new session pays the full startup context (plugins, skills, tool definitions) before doing anything. Continue a session for related work instead of starting a fresh one; start fresh (`/clear`) only between unrelated tasks.
- Keep the model fixed within a session: each model has its own cache, so `/model` (or a skill/command that names another `model:`) re-reads the whole history uncached. Effort changes on Opus/Sonnet 5.5 keep the cache (free). Never use `opusplan` (every plan-mode toggle is a model switch).
- Don't toggle MCP servers or deny whole tools mid-session when tool search is off: it invalidates the cache. Plugin skills/commands/agents/hooks are cache-safe.
- Edits to CLAUDE.md don't apply (or cost anything) until `/clear`, `/compact` or restart. After a long break, accept "resume from summary".
- Be terse: no restating the question, no narration of obvious steps, no summaries of diffs the user can see. Output is ~40% of spend; short answers are the cheapest lever you control.
- Run `/usage-max diet` when startup context looks heavy; unused plugins, long CLAUDE.md and idle MCP servers are paid on every turn.
- Batch/eval runs: wrap in `scripts/eval-cache.mjs` (skips unchanged work) and `scripts/claude-lean.mjs --hold-red`.
- `/usage-max diagnose` ranks the measured levers on this machine. Act on the top ones, not on generic advice.
