<!-- usage-max:start -->
## usage-max (plan budget governor)
- Your plan has a weekly cap. Spend deliberately: default to the cheapest model/effort that can do the job; escalate only after a cheaper attempt fails or the task is clearly hard (architecture, ambiguous debugging).
- Do not use fast mode / Ultrafast tiers unless the user asks. Do not run on the top model for routine edits, formatting, renames, test runs, or search.
- Keep context small: read only needed file ranges, use `rg` with tight patterns, never cat large files/logs (tail/grep instead), summarise tool output before continuing, start a fresh session for unrelated work instead of growing one long thread.
- Batch work: plan once, then edit; avoid re-reading files; avoid repeated full test runs (run the targeted test first).
- Before starting any large autonomous/batch job, run `node <usage-max>/scripts/codex-governor.mjs gate`; exit 20 = RED: defer or shrink the job. 10 = AMBER: low effort, smaller scope.
- Use `/compact` at natural breaks, `/new` between unrelated tasks, `/side` for detours; check `/status` for limits. Never toggle `/fast`.
- Mode is shown by `codex-governor.mjs status`. If the user says the week is tight, treat as RED.
<!-- usage-max:end -->
