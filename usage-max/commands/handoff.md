---
description: Write a handoff doc and task ledger entry so a fresh session can resume with a smaller context.
argument-hint:
- optional focus for this handoff
---

# /handoff

Write `handoff.md` in the project root (update it if it exists) covering:

1. Goal of the current work and how far it got.
2. Key context a fresh session needs (decisions, constraints, file pointers) — not a transcript dump.
3. Checklist of remaining steps with the next step first.
4. Suggested tier for the next step (Haiku/Sonnet/Opus per the routing rubric).

Then append one entry to the task ledger: date, task, tier used, outcome. Tell the user they can now `/compact`, `/clear`, or open a fresh session that reads `handoff.md`.
