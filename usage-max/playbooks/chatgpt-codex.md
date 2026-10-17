# ChatGPT + Codex plan playbook
Facts (OpenAI docs / reporting, Oct 2026; model names change — verify in your picker):
- Plus/Business: local messages metered per 5-hour window with weekly caps on top; Pro: weekly allowance only. Per-model allowances can reset separately. Local and cloud Codex tasks share one pool. Credits can extend past the cap.
- Cheaper model lanes give far more messages per window (Luna class ~350-3000 vs Sol ~15-160 vs Astra ~5-45 on Plus). Fast mode = 2.5x included-limit rate, Ultrafast 8x; image generation burns 3-5x faster.
- ChatGPT app: reasoning is a composer slider (Low default; Medium/High/Extra High draw Thinking limits; Pro models have a separate allowance). Free/Go: per-message Think button.
- Every MCP server/connector and a large root AGENTS.md add context to every message.
Do:
1. Keep thinking Low by default; raise per message only when needed. Never leave Fast/Ultrafast on.
2. Codex: run `node codex/scripts/install.mjs` (hooks + profiles + AGENTS block), then in Codex run `/hooks` once to trust the hooks. `node codex/scripts/codex-governor.mjs models` lists models your sessions used; set them in ~/.usage-max-codex/config.json (modes).
3. `/status` shows remaining limits; `/statusline` can pin rate limits to the footer; `/usage` shows weekly activity. Calibrate the governor from these every few days.
4. `/compact` at breaks, `/new` between tasks, `/side` for detours, `codex exec resume --last` instead of restating context.
5. Batch/CI: `node codex/scripts/codex-lean.mjs --hold-red --bare exec "..."` (defers in RED; skips user config/rules). Don't add `--ephemeral` if you want the run metered.
6. Prune MCP servers (`codex-diet.mjs`), keep AGENTS.md < 4 KB, move workflows to skills.
7. GPT-5.5 retires from ChatGPT/Codex on 2026-10-14: update `model` before then (codex-diet warns).
8. Check usage: chatgpt.com/codex/settings/usage.
