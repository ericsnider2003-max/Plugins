# Handoff — usage-max (Claude + Codex)

> **Status Oct 10:** findings 1–9, 11, 13–20 are fixed in 0.3.0 (see usage-max/README.md changelog). Still open: see "Open items" at the bottom.

## 1. Goal and status
Goal: find why usage-max isn't working, or isn't working as well as it should, on Claude Code and Codex, then agree on and apply fixes.
Status: **analysis done, no code changed yet.** All 10 skills were run in a live cloud session: diet, gate, audit, route, budget, rescue, routing, diagnose, usage-check and handoff. The full source (~3.5k lines) was read. The offline suites pass (`test/run.mjs`, `test/new.mjs`, `codex/test/run.mjs`, `scripts/check.mjs`), so the defects below are all ones the tests don't cover.

## 2. Key context
- Plugin source (synced copy, read-only here): `~/.claude/plugins/synced/<org>_<acct>/usage-max/`. It was uploaded through claude.ai ("My Uploads"), so fixes need a new upload, or the source committed to this repo (`ericsnider2003-max/Plugins`, which is currently empty).
- Environment: a Claude Code cloud container. There is no `~/.claude/settings.json` and no status line. 26 org-synced plugins load (about 31k tokens of descriptions plus ~100 MCP server definitions); real first-turn context is **81k tokens**. Codex isn't installed here, so the Codex findings come from code review and sandbox tests only.
- Repro scripts: the scratchpad has `synced-diet.mjs` and `reset-test.mjs`. Rebuild them from the findings below if the container has been recycled.

### Findings, highest impact first
**Critical: the numbers are wrong, or the governor is a no-op**
1. **Double counting (~2.1x).** Claude Code writes one transcript record per content block (thinking, text, tool_use), and each repeats the same `usage`. `lib.summarizeProjects`, `meter.scanFrom`, `diagnose.mjs` and `inventory` count every record. In this session: 49 records vs 23 unique `message.id`s. This inflates audit, usage-check, diagnose and the governor's burn (and the "measured" figures in the README). Fix: dedupe by `message.id` (+`requestId`).
2. **The governor has no data, so it reads permanently GREEN.** It relies on status-line `rate_limits` (no status line is configured, and plugins can't set one) or a manual `calibrate`. Uncalibrated, it reports GREEN, and `gate` exits 0. Fix: report an explicit UNCALIBRATED state, add a status-line install step, and nag at SessionStart.
3. **The weekly reset breaks both governors** (reproduced in a sandbox):
   - Codex stays **RED** after the reset with zero usage (est 95%, hoursLeft −1) and writes the RED model into `config.toml`.
   - Claude never re-anchors to the new window (estimate stuck at 0 until a new snapshot arrives) and relaxes only one level per Stop event (RED to AMBER at 0% used).
   - Fix: roll the calibration forward +7 days at the reset (pct 0, cumAt = meter at reset) and clear the hysteresis.
4. **The profile is never applied.** `/rescue apply` is prose with no script, and the SessionStart hook points users at it. `governor.applySettings` silently does nothing when `settings.json` is missing, yet still records `appliedMode` and prints "new sessions: opus @ medium". Fix: a real `apply-profile.mjs` (diff → `--write` → backup, creating the file if missing) and truthful status output. All profile keys were confirmed present in the CLI binary.
5. **Cloud persistence.** Everything lives in `~/.claude/usage-max` (calibration, meter, ledger, state), and that directory is lost with each container. Fix: support a project `.claude/settings.json` profile committed to the repo, plus a configurable data directory or environment setup script.
6. **Diet can't see synced/org plugins.** It reads only `settings.enabledPlugins` and `installed_plugins.json`, so it reports 73 tokens against 31k+ actual. Fix: scan `~/.claude/plugins/synced/*/*`, count the plugins' `.mcp.json` servers, and use first-turn transcript context as ground truth. For synced plugins, disabling happens in claude.ai settings, not `settings.json`.

**High**
7. **Haiku 5.5 is unpriced** (`pricing.mjs` only knows haiku-4-5, with no generic `/haiku/` fallback), so its spend counts as $0 in the governor. The scout is pinned to `claude-haiku-4-5-20251001` (also hardcoded in `check.mjs` and `test/live.mjs`). Fix: move to `claude-haiku-5-5` and add its prices from the official pricing page (the scout's figures are unverified).
8. **Security: the trim hooks auto-approve commands.** `hooks/bash-trim.mjs` and `codex-hook.mjs` return `permissionDecision:"allow"`, so `npm/pip install`, `make` and `docker build` run without a permission prompt. Fix: drop "allow" (live-check that `updatedInput` is still honored) or use "ask".
9. **The subagent policy contradicts itself.** The routing skill says subagents are always Haiku/Sonnet, but `budget.mjs` PreToolUse only downgrades in amber/red; in green, general-purpose/Plan/fork subagents inherit Opus.
10. **Routing is passive.** Nothing injects the rubric, and SessionStart only prints a marker line. Fix: a compact routing directive (~150 tokens) as SessionStart `additionalContext`.
11. **usage-check metrics are misleading.** "burn/day" counts raw context tokens (cache reads weighted the same as output), divides by days since an *assumed* Sun 07:00 reset, and can't produce the "≤14%/day" check. Fix: cost-weighted via `meter.recordCost`, and %/day once calibrated.
12. **The ledger is written on every tool call but read by nothing except the tests**, even though `hooks/ledger.mjs:2` says it records activity "for usage-check". (Its above-ceiling warning does work.) Either use it (subagent attribution, ceiling check) or remove the hook.

**Medium**
13. The Codex installer writes placeholder models (`gpt-6.1-sol` / `gpt-6-luna`) into the user's `config.toml` via `applyMode`. It should seed the modes from the current config or `models`, and confirm first.
14. The Codex `SKILL.md` and AGENTS block use a literal `<usage-max>` path that the installer never fills in, so Codex can't run the commands.
15. Codex runs a full `meterAll` walk on every SessionStart/UserPromptSubmit/Stop, and `notify` repeats it. Keep one and throttle it.
16. Codex `decide` goes RED at ≥92% regardless of hours left; Claude requires >6h. The Codex README's weights (15/60) don't match the code (20/65), and it says 11 tests where there are 21.
17. `aboveCeiling` is copied in 4 files with different regexes (`budget.mjs` has no `$` anchor). Consolidate it in `lib.mjs`.
18. `diagnose` and `turnCost` price every cache write at the 1h rate, while the meter uses the real 5m/1h split. Once the 5m profile is applied, diagnose overstates writes and the TTL lever.
19. In green mode, the governor overwrites the user's own model/effort choice. Make it opt-in.
20. Inventory's `/loop` detection gives false positives (it matched skill-listing text). The handoff command's "task ledger" has no defined path. A stray zip (`zi3VZD9Q`, an old plugin copy) ships in the plugin directory. The README component list is stale.

**Still needs a live check:** whether PreToolUse `updatedInput` works without "allow" (there are upstream issues about this); the Codex PreToolUse matcher name and `updatedInput` support; whether Codex `token_count` events also duplicate and how they count reasoning tokens; Haiku 5.5 list prices.

## 3. Remaining steps (next one first)
- [ ] User answers: weekly % and reset time; mainly cloud or local Windows; Codex plan models; trim hook "allow" vs prompt; force Sonnet subagents in green?
- [ ] Commit the plugin source into this repo so fixes are versioned (then re-upload to claude.ai).
- [ ] Fix 1–6 (core correctness), with regression tests for each (dedupe fixture, reset roll-forward, missing settings.json, synced-plugin diet).
- [ ] Fix 7–12, then 13–20.
- [ ] Live checks (list above) in a logged-in local session: `node test/live.mjs`, `node test/baseline.mjs`.

## 4. Suggested tier
Next step (fix implementation): **Sonnet** (`usage-max-worker`) for the mechanical fixes and tests, gated by `usage-max-reviewer`; Opus hub only for the governor reset/calibration redesign (findings 2–5).

## Task ledger
| date | task | tier | outcome |
|---|---|---|---|
| 2026-10-10 | usage-max full analysis (10 skills run, source review, sandbox repro) | Opus hub + 1 Haiku scout | 20 findings; no code changed |

## State after 0.6.0
PR #1 merged to `main`; installs and auto-updates from `ericsnider2003-max/Plugins#main` (verified in an isolated config). One-step installers in `install/`. Codex installs to `~/.usage-max-codex/bin` and is refreshed by the Claude plugin. Live proof: `node usage-max/test/live.mjs`.
Only the user can do: (1) run the installer on their machine; (2) Codex: `node ~/.usage-max-codex/...` not needed - run `usage-max/codex/scripts/install.mjs` once, then `/hooks` -> trust the hooks, then `/usage-max codex doctor`; (3) disable unused synced plugins (`/usage-max diet` prints the commands).

## Codex desktop app note (0.6.1)
The user runs the Codex DESKTOP app plus the CLI. The app cannot open `/hooks` (CLI only). Codex loads Claude plugins' hooks natively (PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT), so the old uploaded 0.1.0 plugin ran 7 Claude-only hooks inside Codex. Fixes: host guard in all Claude hooks, `.codex-plugin/plugin.json` -> `codex/hooks.json`, defer when user-wide hooks are installed. User must remove the old plugin in Codex and trust the new hooks via `/hooks` in the Codex CLI (trust is shared via ~/.codex/config.toml).

## 0.6.2 notes
Kit lives in `install/kit` + `install/build-kit.py` (builds `usage-max-desktop.zip` and `usage-max-plugin-<ver>.zip`; CI checks both). The user's Claude "desktop app" and the "cloud" sessions load only uploaded plugins (no marketplace, no status line): route them through the plugin zip + `4-CALIBRATE-CLAUDE`. Codex desktop app runs tool commands in a read-only sandbox (EPERM on ~/.usage-max-codex): governors degrade gracefully. Real Codex numbers seen: 77% weekly at ~2.15 of 7 days elapsed (~36%/day vs 4.3%/day sustainable).

## 0.6.3 notes
Cloud sessions (desktop app, cloud icon, CLAUDE_CODE_REMOTE=true) start from a blank container: no persistent ~/.claude, no status line, plugin list frozen at start. usage-max works there via the repo route (`enable-here` -> committed `.claude/settings.json`, verified headless) or an uploaded zip. Plan tracking (status line / calibrate / profile) belongs on the user's PC. The Plugins repo itself has `.claude/settings.json` committed. Cowork: upload only, untested.

## 0.7.0 notes
Codex handoff P1-P4 shipped: Windows-safe trim wrapper (plain words only, off on Windows until `selftest-trim` passes), `savings`, `backup`/`restore`. PowerShell/cmd are unverified in the cloud; the user must run `selftest-trim` once.

## 0.8.0 notes
Guards in usage-max/scripts/guard.mjs + hooks/guard.mjs (cold cache, compact nudge, loop, Read hints, subagent cap), ctxfiles.mjs (`context`), digest, queue, chat-prefs. Tests: usage-max/test/guard.mjs (in CI) and live.mjs check 6. Not built: Codex-side equivalents of loop/Read guards.
