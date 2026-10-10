---
description: Triage a task to the smallest capable model tier and dispatch it.
argument-hint: <task description>
---

# /route

Apply the `usage-max-routing` skill to `$ARGUMENTS`:

1. Classify the compute need: Haiku (search/read/web/format), Sonnet (edits/tests/refactors), Opus 5.5 (architecture/root-cause — handled by the Opus 5.5 hub itself, never delegated upward).
2. Respect the micro-task threshold: trivial inline work stays inline.
3. Dispatch large work to `usage-max-scout` / `usage-max-worker`, then gate with `usage-max-reviewer`.
4. State the chosen tier and why in one line before delegating.
