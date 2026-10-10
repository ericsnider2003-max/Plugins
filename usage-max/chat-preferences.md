# Set once, works in every chat (no reminding)

Chat apps (Claude.ai, Cowork, ChatGPT) have no hooks, so a plugin cannot watch them. What they DO have is a place for standing
instructions that is applied to every new chat automatically. Paste the block below there once.

Where (names may shift slightly between app versions):
- Claude.ai and the Claude desktop app: Settings > Profile > "What personal preferences should Claude consider in responses?"
  (applies to every chat). For a project, also paste it into the project's Instructions.
- Cowork: Settings > the global/folder instructions box, plus upload usage-max-plugin-<version>.zip (Settings > Plugins).
- ChatGPT: Settings > Personalization > Custom instructions (and Memory on). For a project, paste into the project's instructions.

## Paste this

```
Be economical with my usage limits. Answer first, briefly; no restating my question, no recap at the end, no unrequested alternatives.
Do not rewrite whole documents or files: show only the changed parts. If a request is large or ambiguous, ask at most one short
clarifying question, then do the work in one pass. Do not re-read or re-summarise material I already gave you in this chat.
Use the smallest effort that gets a correct answer; save deep reasoning for hard problems. When this conversation gets long
(about 30 messages) or changes topic, tell me once and offer a 10-line summary I can paste into a fresh chat.
```

## What stays manual (no app lets a plugin do it)
- Picking a smaller model for simple questions (the model picker).
- Starting a new chat: the block above makes the assistant tell you when a thread is getting expensive, so you do not have to remember.
