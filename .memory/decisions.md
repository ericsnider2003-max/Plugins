# Decisions

One line each: `- YYYY-MM-DD | key | value`. The newest line for a key wins. These are loaded into every session, so keep them short and true.

- 2026-10-11 | !user machine | Windows PC (scripts must work on Windows; no bash-only tricks)
- 2026-10-11 | !automation | Everything must be automatic: no manual reminding, no permission prompts
- 2026-10-11 | !codex usage | Codex is used through ChatGPT: the desktop app and cloud tasks from the mobile app. No assumption of a CLI-only workflow
- 2026-10-11 | !repeated questions | The user is tired of re-answering. Check .memory/decisions.md before asking; record every answer with memory decide
- 2026-10-11 | proof | Every change is proven by the offline suites (node usage-max/scripts/check.mjs, usage-max/test/*.mjs, usage-max/codex/test/run.mjs) plus usage-max/test/live.mjs before merge
- 2026-10-11 | big-project problem | Claude and Codex forget parts of big projects, causing rework; project memory (.memory/) is the fix, built in 0.10.0
