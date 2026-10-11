# codex-limits

- Codex hooks only see the Bash tool, not apply_patch; Codex cloud/mobile run no hooks at all and read only the repo (AGENTS.md, .codex-tasks/). _(2026-10-11)_
- Resume points are shared: ~/.usage-max/resume/<folder>.md is written by Claude Code and Codex hooks and read by whichever tool starts a fresh chat there; cloud/mobile use .codex-tasks/RESUME.md via 'usage-max resume --repo'. _(2026-10-11)_
