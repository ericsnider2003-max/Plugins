<!-- usage-max:start -->
## usage-max (plan budget governor)
- Route routine search, inspection, formatting and test-output summarisation to the cheapest capable lane. Reserve higher reasoning for architecture, ambiguous debugging and final review. Use surplus effort only when the governor reports surplus.
- Never silently downgrade a model the user explicitly requested; ask first. No fast mode / Ultrafast tiers unless asked; never toggle `/fast`.
- Keep context small: read only needed ranges, tight `rg` patterns, tail/grep logs not cat, summarise tool output, fresh session for unrelated work. Plan once, then edit; run the targeted test first.
- Before a large autonomous/batch job run `node <usage-max>/scripts/codex-governor.mjs gate`; exit 20 = RED: defer or shrink. 10 = AMBER: low effort, smaller scope.
- When this plan is RED/AMBER and the other plan (Claude, per `status` shared line) has headroom, RECOMMEND the user shift work there; do not switch accounts or models yourself.
- Cheap first: try mechanical work on low effort and let the test/linter judge; on failure retry once with the error, then raise effort one step. Hard design or unverifiable work starts higher.
- Mode: `codex-governor.mjs status`. If the user says the week is tight, treat as RED. `/compact` at breaks, `/new` between tasks.
<!-- usage-max:end -->
