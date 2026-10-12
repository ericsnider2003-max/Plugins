# usage-max for Codex / ChatGPT
Same governor idea as the Claude plugin: keep the weekly plan from running out before reset.
Install (any OS, Node 18+): `node scripts/install.mjs`, then `node scripts/codex-governor.mjs calibrate <pct from /status> --resets 2026-10-11T11:00:00-07:00`.
Run codex via `node scripts/codex-lean.mjs` (adds `--hold-red` for batch jobs) or just `codex` (hooks/notify keep ~/.codex/config.toml on the right effort for NEW sessions).
Plan: ChatGPT Pro ($100). Run `node scripts/codex-governor.mjs models` to list models seen in your sessions, then set explicit models in ~/.usage-max-codex/config.json `modes`. By default modes have `model: null` (your model is left untouched, only effort/tuning keys are managed); the installer seeds config.json from seen models only if it does not exist yet (needs 2+ distinct models), and never overwrites it.
After the weekly reset passes, the estimate rolls forward 7 days and restarts at 0%; recalibrate any time.
Tested offline (`node test/run.mjs`; was 27 tests, `node test/run.mjs`).
## NOT verified live
- hooks.json matcher name for the shell tool (`Bash`) and PreToolUse `updatedInput` support (the rewrite does not auto-approve commands).
- the `notify` config key / agent-turn-complete event.
- rollout JSONL field names (parsed tolerantly from the documented token_count shape).
- `service_tier` is unset in all modes (fast mode off).
ChatGPT web/app: no hooks exist; see chatgpt/CUSTOM-INSTRUCTIONS.md (manual policy).
Weights are relative (luna 1, sol 20, astra 65) per code; calibration absorbs the scale.

## Stable install location
`install.mjs` copies the Codex scripts to `~/.usage-max-codex/bin` (with a `VERSION` file) and writes only that path into `~/.codex`. The Claude plugin cache path changes on every update, so the Claude-side refreshes this copy when the plugin version changes (re-run `node <plugin>/codex/scripts/install.mjs` if `doctor` says hooks point elsewhere).

## Codex checklist (read this if it "does nothing")
1. `node scripts/install.mjs`
2. Start Codex, run `/hooks`, and **trust the usage-max hooks**. Codex silently skips untrusted hooks. No re-trust is needed after plugin updates: the installer copies the scripts to a stable `~/.usage-max-codex/bin` and hooks/notify point there, so the path (the hook's identity) never changes.
3. `node scripts/codex-governor.mjs doctor` tells you exactly what is missing. Calibration is automatic after your first Codex turn (the plan % is read from Codex's own `rate_limits`).

## Surplus mode
When the mode is GREEN, the 5h guard is green, and the week is projected to end under 80% used with more than 12h left, `status` shows `GREEN+SURPLUS` and new sessions use the `surplus` mode's effort (default `high`; edit `modes.surplus` in `~/.usage-max-codex/config.json`). It stays on until the projection passes 90%, the mode leaves green, or 12h or less remain. `gate` still exits 0.

## Balancing with Claude
Each side writes its own entry (`codex`/`claude`) in `~/.usage-max/shared.json`. When your Codex plan is AMBER/RED and Claude's fresh (under 6h old) status is GREEN, the SessionStart/UserPromptSubmit hook tells the model to suggest moving big work to Claude. `status` shows a `claude plan:` line and `doctor` reports whether the shared status is fresh, stale or missing.

## Output trimming (all shells, incl. Windows) — OFF until you opt in
Codex only honours a rewritten command when the hook also marks it pre-approved, and that skips Codex's own approval prompt for that command. So trimming is **off by default**. Turn it on with `{"trimApprove": true}` in `~/.usage-max-codex/config.json` (`doctor` shows the state). Everything below applies once it is on.

The PreToolUse hook rewrites a short allowlist of noisy, simple commands (npm/pnpm/yarn install/test/build, pytest, go/cargo/dotnet test, mvn, gradle, docker build, tsc, make ...) to `node "<bin>/scripts/run-trimmed.mjs" run <the same words>`, for example `npm test` becomes `node ".../run-trimmed.mjs" run npm test`: the real command stays readable in Codex's approval prompt and to its auto-review (nothing is hidden or encoded). Only commands made of plain words (letters, digits and `_ @ + = : , . / -`) are rewritten, so PowerShell, cmd and sh pass identical tokens; anything with quotes, backslashes, globs, `%` or `~` is left exactly as written. `run-trimmed.mjs` refuses anything else (it is not a general command runner) and runs it via the platform shell (cmd.exe / sh), merges stdout+stderr in arrival order, keeps head, tail and every error/warning line, and exits with the command's exact exit code (spawn failure 127, refused input 2). Never rewritten: commands with pipes, redirects, `; & \` $ ( )`, newlines, `--no-trim`, `--reporter`, `--json`, `-q`/`--quiet`. Permissions and approvals are unchanged (the hook returns `allow` only because Codex requires it for `updatedInput`; your approval policy still governs what runs).
- Windows is OFF until proven on your machine: run `node <bin>/scripts/codex-governor.mjs selftest-trim` once. It runs a noisy fake command through `powershell.exe` and `cmd.exe` (skips one that is missing) and writes `~/.usage-max-codex/trim-ok.json` only if every shell that ran returned exit 3 with the error line and tail kept. `USAGE_MAX_TRIM=force` skips the check. Other platforms: on once you opt in, by default.
- Rollback (either one): environment `USAGE_MAX_TRIM=off`, or `"trim": "off"` in `~/.usage-max-codex/config.json`. Delete `trim-ok.json` to turn Windows back off. `doctor` shows trim status and stats.
- `trim-stats.json` keeps only aggregate counters (rewrites, rawBytes, outBytes, lastAt), never command text.
- NOT verified: PowerShell/cmd execution (developed and tested on Linux only; the self-test is the proof on your machine).

## Savings report
`node scripts/codex-governor.mjs savings [--days 7] [--since <ISO>] [--json]`. Read-only (writes nothing, works in the sandbox), local logs only. Each line is labelled `measured` (sessions, turns, tool-output bytes, provider-reported `token_count` totals if the logs have them else "not available in logs", trim counters, model/effort lanes, time in each budget mode from `governor.json` `history`) or `estimate` (tokens = bytes/4; tokens removed by trim = (raw-out)/4). Before/after splits at `installedAt` (recorded once by the installer) or `--since`; shown per turn and flagged workload-dependent, not a guarantee. Not a statement of provider billing.

## Backup and restore
- `node scripts/codex-governor.mjs backup [--out <dir>]` writes `<dir or ~/.usage-max-backups>/codex-<UTC time>[-2..]/` (never overwrites) with `bin/VERSION`, `codex/{hooks.json,config.toml,AGENTS.md,usage-max-*.config.toml,*.usage-max-backup,*.usage-max-diet-backup}`, `data/{config.json,governor.json,trim-stats.json}` and `MANIFEST.json` (sha256 + bytes). Missing files are skipped and listed. `config.toml` carries the saved hook-trust entries.
- `restore --check <dir>`: verifies every sha256 and shows per file whether it differs from the current one (read-only).
- `restore <dir> --apply`: refuses if the check fails; otherwise takes a normal backup of the current state first, then copies the files back (`bin/VERSION` is informational and not restored; files not in the backup are left alone).
- After a restore: fully quit and reopen the Codex app, then in the Codex CLI run `/hooks` and confirm the usage-max hooks show as trusted. NOT verified: how the Codex desktop app re-reads `config.toml`/`hooks.json`, and that the trust hashes in the restored `config.toml` are accepted; this is why the step above is needed.
