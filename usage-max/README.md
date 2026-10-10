# usage-max

Route every task to the smallest capable model tier and prove the savings from local transcripts. Ceiling: Opus 5.5. No fable. Zero Claude usage spent building or verifying this plugin.

## 0.3.0 (Oct 10 2026)
- **Self-configuring.** SessionStart now merges the usage profile (settings, status line, marketplace auto-update) with a backup, and tells Claude the routing rules. Opt out: `USAGE_MAX_AUTOAPPLY=off`.
- **Governor learns from real plan %.** The burn rate now comes from the plan's own percentages (so Cowork/chat usage counts) with no manual calibrate; a pace-aware 5-hour-cap guard tightens only if you would hit the cap before it resets.
- Subagents never run above Sonnet in any budget mode; the output-trim hook no longer bypasses your permission prompts; ledger only logs subagent dispatches; one shared ceiling check.
- **Codex:** reads the plan's real `rate_limits` from its own logs (auto-calibration + 5-hour guard), `codex-governor.mjs doctor` diagnoses why it is not active (hooks must be trusted via `/hooks`), reset roll-forward, no placeholder models written, working install paths, throttled metering.
- Cache-write pricing honours the real 5m/1h split; `/loop` detection no longer false-positives.

## 0.2.0 (Oct 10 2026)
- Usage was counted ~2x (one transcript record per content block repeats the same usage); everything now counts each message once.
- Weekly reset no longer leaves the governor stuck in last week's mode (Claude and Codex).
- `scripts/profile.mjs` is the real `/rescue apply`. Diet sees claude.ai/org-synced plugins and reports the measured session-start context. usage-check is cost-weighted. Haiku 5.5 is priced and is the scout model.

## Install

```
/plugin marketplace add ericsnider2003-max/Plugins
/plugin install usage-max@eric-plugins
```
The first session configures everything itself (check with `/usage-max:budget`). Future versions arrive automatically (`autoUpdate` is set by the profile). Codex: see `codex/README.md`.

Uninstall: restore the settings backup, then `claude plugin uninstall usage-max`.

## Components

- [plugin.json](.claude-plugin/plugin.json) — manifest (validates clean, incl. `--strict`)
- [agents/](agents/) — `usage-max-scout` (haiku, read-only+web), `usage-max-worker` (sonnet, verify-by-running), `usage-max-reviewer` (sonnet gate)
- [routing skill](skills/routing/SKILL.md) — triage rubric, hub discipline, handoff boundaries, escalation (1 retry/tier, 2-failure stop, ≤2 parallel)
- [commands/](commands/) — `/route`, `/handoff`, `/usage-check`, `/audit`, `/rescue`, `/diagnose`
- [hooks/](hooks/) — fail-open SessionStart marker + PostToolUse ledger (rotated, 5 files max)
- [scripts/](scripts/) — `audit.mjs`, `usage-check.mjs` (with `--write-status` for the statusline), `inventory.mjs`, `statusline.mjs`, `check.mjs`, shared `lib.mjs`
- [profiles/](profiles/) — `settings.enforced.json` (Stage B), `settings.strict.json` (Stage C kill-switch), `background-job.md` (headless one-shot + Task Scheduler fallback)
- [tests](test/run.mjs) — offline fixtures + hook/statusline verification (`node test/run.mjs`)

## Maximize the plan (measured, Oct 7 2026)

`/usage-max:diagnose` prices every local turn at list price and ranks the levers. On this machine (7 days, 4,004 turns, 642 sessions, ~600 of them automated `claude -p` runs):

- Cache writes 43%, output 42%, cache reads 15%. Long context is not the problem (p99 136k, no turn over 151k).
- 5-minute cache TTL: replaying every session with its real gaps saves ~16%; the 1-hour TTL never paid for its 2× write rate here → `promptCacheTtl: "5m"`.
- Startup context: 42k tokens per session, ~40% of all usage. `node test/baseline.mjs` measures how much of it is plugins/skills/MCP (normal vs `--safe-mode`).
- The status line reads the plan's real 5-hour and weekly percentages, shows pace (cap warning, or "spend more" when allowance would go unused), and snapshots them for `/usage-check`.

## Strategy (the short version)

One hub session per project on Opus 5.5 (`claude-opus-5-5`, pinned — the `opus` alias is pinned to 5.5 too); scouts explore in sidechains; workers execute on Sonnet with cheap local checks (`cargo check`, `pytest -q`, `tsc --noEmit`); reviewer gates quality; nothing ever runs above Opus 5.5. Background work becomes bounded headless one-shots. `/usage-check` reports both windows vs the ~10%-per-5h pacing heuristic; the budget guard alerts at 60/75/90%.

## Measured on this machine (Phase 0, Oct 7 2026)

- Weekly bucket at 57% after 2.68 days → 21.3%/day → projected cap **Oct 9** unless the profile changes.
- Token split: Sonnet 2,638 turns (152.7M ctx), Opus 156 turns (9.5M ctx), Haiku 2 turns, **0 sidechain turns** — no subagent routing in use; everything runs in main loops.
- 15 transcript projects touched in the last hour (32 sessions in one hub workspace) — the multi-session churn the migration template targets.

## Limitations (honest)

- Local transcripts can't see claude.ai chat, Cowork cloud sessions, or other devices — subtract the local total from Settings > Usage for that share.
- Subagent model overrides have an upstream bug (#43869, still open): the ledger + transcript assertions detect it; the strict profile is the fallback.
- Ccusage, handoff patterns, and community skills are aids, not savings sources — every adopted skill keeps a drop criterion in `/usage-check` attribution.

## Governed batch runs (gate)
`node scripts/governor.mjs gate` exits 0/10/20 (green/amber/red). Wrap automated `claude -p` runs with
`node scripts/claude-lean.mjs --hold-red -p "..."`: in RED it exits 75 (defer), otherwise it injects/downgrades `--model` to the mode's tier (`--force-model` to override).
Codex/ChatGPT port lives in `codex/` (see codex/README.md).

## Context & cost tools
- `/usage-max:diet` (`scripts/plugin-diet.mjs`): always-loaded context per plugin/CLAUDE.md/MCP vs real 30-day use from transcripts; `--disable` turns plugins off (new sessions).
- `scripts/eval-cache.mjs`: content-hash cache for eval/batch commands (stdout + artifacts replay, failures never cached, `status`/`clear`, `USAGE_MAX_EVAL_CACHE=off`).
- `hooks/bash-trim.mjs`: PreToolUse rewrite of noisy simple commands (npm/pip install/test, pytest, go/cargo test, docker build, make…) through `scripts/trim.mjs` (head/tail/errors; exit status preserved with pipefail). `USAGE_MAX_TRIM=off` disables; commands with pipes/redirects are never touched.
- Profile adds idle-waste settings: `CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0`, `crossSessionInbound: hold`, `autoContinueAtUsageLimit: true`.
- Codex: `codex/scripts/codex-diet.mjs` audits AGENTS.md size, MCP scoping, compaction config (`--apply`, `--disable-mcp`).

## Round 2 (Oct 7): implemented from research
- Profiles/settings: telemetry/survey/away-summary/terminal-title requests off, BASH_MAX_OUTPUT_LENGTH=15000, idle-waste keys (see profiles/).
- claude-lean: default `--max-turns 40` for headless `-p` (USAGE_MAX_TURNS); pass `--bare` yourself for eval runs.
- Routing skill: prompt-cache rules (model switch / MCP toggle / opusplan invalidate; effort change on 5.5 doesn't).
- Codex: hooks (`codex-hook.mjs`: SessionStart/UserPromptSubmit directives, Stop mode change, PreToolUse trim), installer merges `~/.codex/hooks.json` (run `/hooks` in Codex to trust), `codex-governor models`, plan_mode_reasoning_effort + project_doc_max_bytes in profiles, codex-lean `--bare`, GPT-5.5 retirement + fast-tier warnings in codex-diet.
- playbooks/: manual guides for Cowork and ChatGPT/Codex.
