---
description: Apply the enforced usage profile, migrate background work to scheduled bursts, or halt everything in an emergency.
argument-hint:
- apply | migrate | halt
---

# /rescue

Default (no argument): print the Day-0 manual rescue — `/model claude-opus-5-5` in active sessions, Sonnet on the agent-view header before dispatching, close idle background sessions — plus the path to the enforced profile at `profiles/settings.enforced.json`.

- `apply`: verify the enforced profile fields against `~/.claude/settings.json` and report drift (never overwrite silently — show the diff first).
- `migrate`: walk the background-migration template in `profiles/background-job.md` — kill idle always-on rows (hubs stay), convert each job to a bounded headless one-shot with mandatory `--max-turns` and `--model`.
- `halt`: emergency stop — list how to kill every loop, background session, and scheduled task immediately (`claude agents` rows, `/loop` cancellations, Task Scheduler/Desktop Routines entries).
