# usage-max for Codex / ChatGPT
Same governor idea as the Claude plugin: keep the weekly plan from running out before reset.
Install (any OS, Node 18+): `node scripts/install.mjs`, then `node scripts/codex-governor.mjs calibrate <pct from /status> --resets 2026-10-11T11:00:00-07:00`.
Run codex via `node scripts/codex-lean.mjs` (adds `--hold-red` for batch jobs) or just `codex` (hooks/notify keep ~/.codex/config.toml on the right effort for NEW sessions).
Plan: ChatGPT Pro ($100). Run `node scripts/codex-governor.mjs models` to list models seen in your sessions, then set explicit models in ~/.usage-max-codex/config.json `modes`. By default modes have `model: null` (your model is left untouched, only effort/tuning keys are managed); the installer seeds config.json from seen models only if it does not exist yet (needs 2+ distinct models), and never overwrites it.
After the weekly reset passes, the estimate rolls forward 7 days and restarts at 0%; recalibrate any time.
Tested offline (27 tests, `node test/run.mjs`).
## NOT verified live
- hooks.json matcher name for the shell tool (`Bash`) and PreToolUse `updatedInput` support (the rewrite does not auto-approve commands).
- the `notify` config key / agent-turn-complete event.
- rollout JSONL field names (parsed tolerantly from the documented token_count shape).
- `service_tier` is unset in all modes (fast mode off).
ChatGPT web/app: no hooks exist; see chatgpt/CUSTOM-INSTRUCTIONS.md (manual policy).
Weights are relative (luna 1, sol 20, astra 65) per code; calibration absorbs the scale.

## Codex checklist (read this if it "does nothing")
1. `node scripts/install.mjs`
2. Start Codex, run `/hooks`, and **trust the usage-max hooks**. Codex silently skips untrusted hooks. Re-trust after moving or reinstalling the plugin (the path is part of the hook identity).
3. `node scripts/codex-governor.mjs doctor` tells you exactly what is missing. Calibration is automatic after your first Codex turn (the plan % is read from Codex's own `rate_limits`).

## Surplus mode
When the mode is GREEN, the 5h guard is green, and the week is projected to end under 80% used with more than 12h left, `status` shows `GREEN+SURPLUS` and new sessions use the `surplus` mode's effort (default `high`; edit `modes.surplus` in `~/.usage-max-codex/config.json`). It stays on until the projection passes 90%, the mode leaves green, or 12h or less remain. `gate` still exits 0.

## Balancing with Claude
Each side writes its own entry (`codex`/`claude`) in `~/.usage-max/shared.json`. When your Codex plan is AMBER/RED and Claude's fresh (under 6h old) status is GREEN, the SessionStart/UserPromptSubmit hook tells the model to suggest moving big work to Claude. `status` shows a `claude plan:` line and `doctor` reports whether the shared status is fresh, stale or missing.
