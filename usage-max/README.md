# usage-max

Route every task to the smallest capable model tier and prove the savings from local transcripts. Ceiling: Opus 5.5. No fable. Zero Claude usage spent building or verifying this plugin.

## 0.6.2 (Oct 10 2026) — from the user's real Windows / desktop-app screenshots
- **Desktop-app and cloud sessions are first-class.** They only see UPLOADED plugins, so the kit now includes `usage-max-plugin-<version>.zip` (the exact shape "Upload local plugin" accepts; the big kit zip is rejected there) and START-HERE explains which route to use for the Claude desktop app, the Claude Code terminal, and Codex.
- **No status line in the desktop app?** `4-CALIBRATE-CLAUDE` (or `usage-max budget calibrate 67% --resets "Oct 11 2026 11:00 AM"`) now works with no local history, accepts a typed date, and every reading is also a plan-% snapshot, so two readings a few hours apart give a real burn rate. With one reading it uses your average pace since the week began (it can no longer be inflated by usage that happens elsewhere).
- **Codex sandbox safe.** When the Codex app runs the governor in a read-only shell (EPERM) it now prints live numbers and says plainly that saving was blocked, instead of crashing; the hooks (which run outside the sandbox) keep the saved state.
- `doctor --fix` applies the safe profile (never overwriting your settings) and then checks; uploads are recognised (no false "auto-update" FIX). The kit is built by `install/build-kit.py` and CI checks it, including that no `.cmd` uses parenthesised blocks (a cmd.exe trap).

## 0.6.1 (Oct 10 2026) — found from a real Codex screenshot
- **Codex runs Claude plugins' hooks.** Verified in Codex's source: it loads `.claude-plugin/plugin.json` plugins, runs their `hooks/hooks.json`, and sets `CLAUDE_PLUGIN_ROOT`. The old uploaded copy's seven Claude-only hooks were therefore running inside your Codex app (and had saved trust), which is the likely cause of disrupted turns.
- Every Claude hook now detects Codex and does nothing there (never touches Claude settings from inside Codex).
- The plugin ships a Codex manifest (`.codex-plugin/plugin.json` -> `codex/hooks.json`, with a Windows `commandWindows`), so if it is installed into Codex it loads only the Codex hooks. If you also ran the Codex installer, the plugin copy defers (nothing runs twice).
- `doctor` flags leftover usage-max plugin entries in Codex config. CI checks that the three manifests agree on the version.
- Launchers: find the installed plugin when run from inside a zip (with a plain-English message), and stop claiming success after a failure.

## 0.6.0 (Oct 10 2026)
- **One-step install** (`install/install-usage-max.cmd` for Windows, `.sh` for macOS/Linux): adds the marketplace pinned to `main`, installs the plugin, turns off the older uploaded copy. Verified end to end in an isolated Claude config, including re-runs. Auto-update follows `main` regardless of GitHub's default branch.
- **Codex survives plugin updates.** Codex scripts now install to a stable folder (`~/.usage-max-codex/bin`) and are refreshed automatically whenever the Claude plugin updates, so hook paths (and your `/hooks` trust) never change.
- `doctor` compares your version with `main` and flags a leftover older uploaded copy (it would run every hook twice); SessionStart warns about it too.
- Start-up safety: the cache-lifetime replay has a 3 s time budget (700 sessions take under 1 s) and SessionStart's hook timeout is 20 s.

## 0.5.1 (Oct 10 2026) — from an independent adversarial review
- **Your settings win.** usage-max records what it wrote (`~/.claude/usage-max/applied.json`) and never reverts a value you changed (cleanupPeriodDays, env vars, cache TTL, status line, model). `doctor`/`rescue apply` list what was kept. Only exception: in AMBER/RED the governor may force a cheaper model/effort for new sessions, and hands back when green returns. Opt out of all of it with `{"manageSettings": false}` or `USAGE_MAX_AUTOAPPLY=off`.
- Surplus mode needs real, recent plan-% burn data (no data / silent status line = off). A snapshot with no valid timestamp, or a stale 5-hour reading, is never treated as fresh.
- Settings writes follow symlinks (stow/chezmoi) and keep the file mode; subagent rewrites no longer auto-approve the Agent call; `inherit` subagents are capped to Sonnet; cache-lifetime replay is cached for 6h.

## 0.5.0 (Oct 10 2026)
- **Live-proven.** `node test/live.mjs` runs the real `claude` CLI with this checkout loaded (state sandboxed): SessionStart self-configures and injects the routing rules, `/usage-max` registers, an Opus subagent request is rewritten to Sonnet (only Sonnet billed), Stop meters, and a command rewrite works without `permissionDecision: "allow"`. CI (`.github/workflows/usage-max.yml`) runs all offline suites on every PR.
- **Diet uses Claude Code's own numbers** (`claude plugin details`): your synced plugins are ~40k tokens of every session start. Advice now includes the exact `claude plugin disable <name>@synced --scope user` command (use `--scope project` to slim down just one repo).
- **Cache lifetime is learned from your own sessions** (5m vs 1h replay with real gaps) instead of hardcoded; falls back to the profile default until there are 5+ sessions.
- **Pace planner** in `status`: the %/day the plan can sustain vs what you are using, and a "use it or lose it" line when allowance is about to expire at reset.

## 0.4.0 (Oct 10 2026)
- **One command.** Nine slash commands collapsed into `/usage-max <sub>` (status, doctor, budget, gate, check, diagnose, audit, diet, rescue, balance, route, handoff, codex): one thing to remember, less startup context. `doctor` checks Claude and Codex together.
- **Cross-plan balancing.** Both governors publish their state to `~/.usage-max/shared.json`; when one plan is AMBER/RED and the other is GREEN, Claude (and Codex) are told to shift large work to the plan with headroom (via the codex-dispatch skill when installed).
- **Surplus mode.** If the week is on course to leave >20% unused (and >12h remain), the hub gets higher effort for hard problems (Opus `high`, subagents stay `medium`); hysteresis 80/90; never in AMBER/RED. Same on Codex.
- Official prices verified: Sonnet 5.5 cache reads are $0.10; Haiku 5.5 ($0.10 in / $0.50 out up to 100k prompt, $0.50 / $2.50 above) is priced by prompt size.
- Data-driven context cap: `diagnose` recommends `autoCompactWindow` only when your own sessions would save >=5%; applied only if you opt in.
- Live-verified in Claude Code: a PreToolUse command rewrite is honoured *without* `permissionDecision: "allow"`, so the trim hook never bypasses your permission prompts.
- Tests can no longer touch the real `~/.claude` (everything runs in a sandbox home).

## 0.3.0 (Oct 10 2026)
- **Self-configuring.** SessionStart now merges the usage profile (settings, status line, marketplace auto-update) with a backup, and tells Claude the routing rules. Opt out: `USAGE_MAX_AUTOAPPLY=off`.
- **Governor learns from real plan %.** The burn rate now comes from the plan's own percentages (so Cowork/chat usage counts) with no manual calibrate; a pace-aware 5-hour-cap guard tightens only if you would hit the cap before it resets.
- Subagents never run above Sonnet in any budget mode; the output-trim hook no longer bypasses your permission prompts; ledger only logs subagent dispatches; one shared ceiling check.
- **Codex:** reads the plan's real `rate_limits` from its own logs (auto-calibration + 5-hour guard), `codex-governor.mjs doctor` diagnoses why it is not active (hooks must be trusted via `/hooks`), reset roll-forward, no placeholder models written, working install paths, throttled metering.
- Cache-write pricing honours the real 5m/1h split; `/loop` detection no longer false-positives.

## 0.2.0 (Oct 10 2026)
- Usage was counted ~2x (one transcript record per content block repeats the same usage); everything now counts each message once.
- Weekly reset no longer leaves the governor stuck in last week's mode (Claude and Codex).
- `scripts/profile.mjs` is the real `/usage-max rescue apply`. Diet sees claude.ai/org-synced plugins and reports the measured session-start context. usage-check is cost-weighted. Haiku 5.5 is priced and is the scout model.

## Install

Run the installer once (needs only the `claude` CLI):
- Windows: double-click `install/install-usage-max.cmd`
- macOS/Linux: `sh install/install-usage-max.sh`

Or by hand: `claude plugin marketplace add "ericsnider2003-max/Plugins#main"` then `claude plugin install usage-max@eric-plugins`.

The first new session configures everything itself and the plugin keeps itself updated. Check anytime with `/usage-max doctor`. Codex: see `codex/README.md`.

## One command

Everything is `/usage-max <sub>` (no argument = `status`). The same entry works from a terminal: `node scripts/usage-max.mjs <sub>`.

| sub | what it does |
|---|---|
| `status` | plan %, mode (GREEN / AMBER / RED, `+SURPLUS`), burn vs sustainable, and the other plan's headroom |
| `doctor` | is everything active — Claude *and* Codex — and exactly what to fix |
| `budget [calibrate <pct> --resets <date> \| mode <auto\|green\|amber\|red>]` | the governor |
| `gate` | exit 0/10/20 for scripts (wrap batch runs with `scripts/claude-lean.mjs --hold-red`) |
| `check` · `diagnose` · `audit` · `diet` | local-transcript reports: burn by model, ranked savings, leaks, startup context per plugin |
| `rescue [apply [--write] \| migrate \| halt]` | apply the profile, move background work to bounded one-shots, emergency stop |
| `balance` | Claude vs Codex headroom |
| `codex <doctor\|status\|install\|models\|calibrate\|mode\|diet>` | the Codex side |
| `route <task>` · `handoff` | model-driven: tier a task / write `handoff.md` |

Under it: three subagents (`usage-max-scout` Haiku 5.5, `-worker` Sonnet 5.5, `-reviewer` Sonnet 5.5), the `usage-max-routing` skill, and hooks that configure themselves, track the budget, cap subagents at Sonnet, and tell Claude when to work economically, when allowance is going unused (surplus) and when Codex has headroom.

## Components

- [scripts/usage-max.mjs](scripts/usage-max.mjs) — the dispatcher; [commands/usage-max.md](commands/usage-max.md) — the one slash command
- [agents/](agents/), [skills/routing](skills/routing/SKILL.md), [hooks/](hooks/) (fail-open), [scripts/](scripts/), [profiles/](profiles/), [codex/](codex/), [test/](test/)

## Maximize the plan (measured, Oct 7 2026)

`/usage-max diagnose` prices every local turn at list price and ranks the levers. On this machine (7 days, 4,004 turns, 642 sessions, ~600 of them automated `claude -p` runs):

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
- `/usage-max diet` (`scripts/plugin-diet.mjs`): always-loaded context per plugin/CLAUDE.md/MCP vs real 30-day use from transcripts; `--disable` turns plugins off (new sessions).
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
