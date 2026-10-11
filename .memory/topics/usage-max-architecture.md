# usage-max-architecture

- Claude hooks live in usage-max/hooks, shared logic in usage-max/scripts; Codex hooks in usage-max/codex/scripts and must stay self-contained (they are copied to ~/.usage-max-codex/bin). _(2026-10-11)_
- scripts/memory.mjs is dependency-free on purpose: the Codex sync copies it next to codex-hook.mjs. _(2026-10-11)_
