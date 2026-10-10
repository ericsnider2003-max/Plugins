# Cowork / claude.ai usage playbook (manual — no hooks exist there)
Cowork and chat draw from the same plan as Claude Code, and agentic tasks use far more per task than chat.
1. Audit connectors, plugins and memory: every enabled connector/plugin/skill adds context to EVERY task. Disable what you don't use (Settings > Connectors / Plugins). This session lists ~25 plugins' skills; most are irrelevant to trading/skill work.
2. One task per session. Don't keep a Cowork thread alive for unrelated follow-ups; start fresh and use a Project for the context you do need.
3. Prefer the lighter model (Sonnet/Haiku class) for routine work; reserve Opus for hard reasoning.
4. Ask for concise output ("answer in <=5 lines, no recap"). Output tokens cost ~5x input.
5. Move heavy standing instructions out of memory/Project instructions into skills that load on demand; prune stale memory files.
6. Recurring routine work -> scheduled tasks (cheap, off your attention) but keep their prompts tight: each firing starts a fresh session with full startup context.
7. Shift heavy runs off-peak; keep extra-usage credits as a buffer rather than a plan.
8. Heavy local/coding work belongs in Claude Code with the governor, not in Cowork.
Check: claude.ai Settings > Usage (weekly bar + reset time). Calibrate the Claude Code governor from it.
