# Set once, works in every chat (no reminding)

Last updated: 2026-10-16. Last reviewed after the latest filing refresh. The rebuilt control plane now observes Claude Code
and Codex through supported hooks and can ingest redacted host attachments;
these standing instructions remain only a fallback for chat surfaces without a
supported host bridge. They do not make ChatGPT/Cowork automatically governed.

Chat apps (Claude.ai, Cowork, ChatGPT) have no hooks, so a plugin cannot watch them. What they DO have is a place for standing
instructions that is applied to every new chat automatically. Paste the block below there once.

Where (names may shift slightly between app versions):
- Claude.ai and the Claude desktop app: Settings > Profile > "What personal preferences should Claude consider in responses?"
  (applies to every chat). For a project, also paste it into the project's Instructions.
- Cowork: Settings > the global/folder instructions box, plus upload usage-max-plugin-<version>.zip (Settings > Plugins).
- ChatGPT: Settings > Personalization > Custom instructions (and Memory on). For a project, paste into the project's instructions.

## Paste this

```
Use Usage-max to observe allowance and automatically select an appropriate model/effort for new work. During authorized interactive work, continue until the task is complete or genuinely blocked. Do not shorten the work window, ask permission for long work, or recommend a fresh chat because of Usage-max. Use hard budget gates only for explicitly requested batch, CI, or evaluation work.
```

## Project memory in chats (ChatGPT / Cowork / Claude.ai)
Chats cannot read your repo's `.memory/` by themselves. Two ways: (1) in a Project, upload `.memory/INDEX.md` (or run `usage-max memory export` and paste its output into the Project instructions); re-do it when decisions change. (2) For Codex tasks started from the ChatGPT or mobile app, commit `usage-max memory sync` output (it fills `AGENTS.md`); cloud tasks read it from the repo, so there is nothing to paste.

## What stays manual (no app lets a plugin do it)
- Picking a smaller model for simple questions (the model picker).
- Starting a new chat: the block above makes the assistant tell you when a thread is getting expensive, so you do not have to remember.
