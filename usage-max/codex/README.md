# usage-max for Codex / ChatGPT
Same governor idea as the Claude plugin: keep the weekly plan from running out before reset.
Install (any OS, Node 18+): `node scripts/install.mjs`, then `node scripts/codex-governor.mjs calibrate <pct from /status> --resets 2026-10-11T11:00:00-07:00`.
Run codex via `node scripts/codex-lean.mjs` (adds `--hold-red` for batch jobs) or just `codex` (notify hook keeps ~/.codex/config.toml on the right model/effort for NEW sessions).
Tested offline (11 tests, `node test/run.mjs`). NOT verified live: (1) rollout JSONL field names are parsed tolerantly from the documented token_count shape; (2) model names in config.json defaults (gpt-6.1-sol / gpt-6-luna) are examples — edit ~/.usage-max-codex/config.json `modes` to models your account lists in /model; (3) `service_tier` unset in all modes (fast mode off); (4) the notify event fires per turn so mode changes apply from the next session.
ChatGPT web/app: no hooks exist; see playbooks/chatgpt-codex.md and chatgpt/CUSTOM-INSTRUCTIONS.md (manual policy).
Weights are relative (luna 1, sol 15, astra 60) from Plus message ratios; calibration absorbs the scale.
