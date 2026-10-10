# Background-job migration template

Replace every always-on background session (hubs stay) with a bounded headless one-shot.

## The invocation (all three flags mandatory)

```sh
claude -p "__PROMPT__" --max-turns __N__ --model claude-sonnet-5-5 --output-format json
```

- `--max-turns` bounds the run (8–15 for checks, per-job).
- `--model claude-sonnet-5-5` pins the tier per fire, independent of settings.
- `--output-format json` keeps results parseable and the session short.

## Scheduling

- Desktop Routines page (local tasks), or `/loop` inside a session for polling.
- Reliability fallback (see issue #44129 — scheduled tasks can silently not fire): Windows Task Scheduler running the command above. Example (fill in placeholders first):

```cmd
schtasks /create /tn "usage-max-build-check" /tr "claude -p \"Run the build check in __REPO__ and report JSON\" --max-turns 8 --model claude-sonnet-5-5 --output-format json" /sc MINUTE /mo 30
```

Verify with the fire-count check in `inventory.mjs`.
- Cloud Routines only for jobs needing no local files.

## Safety profile for unattended runs

Deny push/delete/destructive commands and out-of-repo writes. Read-only checks where possible; any write is scoped to the project and reported as JSON.
