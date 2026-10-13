# usage-max

Route every task to the smallest capable model tier and prove the savings from local transcripts. Ceiling: Opus 5.5. No fable. Zero Claude usage spent building or verifying this plugin.

## 0.19.1 (Oct 13 2026) — safety: nothing lost, nothing switched off
- **Prompt suggestions are no longer switched off** by the strict profile (it was a product feature). If an older version wrote that switch-off, it is handed back; a switch-off you chose yourself stays.
- **Trimmed command output always has a saved copy.** If the complete output cannot be saved (full disk, read-only folder), the whole output is shown instead of a trimmed version with no copy.
- **A cached passing result is no longer replayed in a different folder** (the working folder is part of the cache key; old entries miss once). Cached output is now redacted, stored private and pruned.
- **Your own files are edited more carefully:** a linked or private config file keeps its link and permissions; syncing project notes into AGENTS.md/CLAUDE.md keeps the file's line endings and encoding, writes atomically and keeps the previous copy outside your repo.
- **"From now on…" in an ordinary request is no longer saved as a permanent project rule.** It needs a colon or a remember word, and text with an email address or a secret is refused with a message.
- **The Codex installer fails loudly** (exit code and a list) instead of ending "installed" when its hooks file is corrupt.
- **Restoring a backup cannot write outside the Codex or data folder** (backslashes, drive letters and `..` are refused).
- **Big files:** transcripts are read in 8 MB pieces (a gigabyte transcript used to risk running out of memory); a huge pasted prompt no longer slows project-note recall; a huge unbroken line in CLAUDE.md no longer stalls session start.
- **Smaller fixes:** no pace advice for a window that already reset; no 5-hour "cap" warning in the first tenth of a window; a mistyped `--days` is refused; a reset typed without a time of day is refused; failed saves leave no stray temp files; the tests now run the real code and ignore a CODEX_HOME in your environment.
- Known and still open (next release): live streaming of trimmed output, and passing typed `/usage-max` text as data rather than through the shell line (needs a check in the real app first).

## 0.19.0 (Oct 13 2026) — accurate numbers
- **The weekly estimate no longer overshoots.** Spend was kept per hour and spread evenly across the hour, so a burst just before a reading was counted again after it (the reported 15% vs real 4%). The last 24 hours are now kept per minute, for Claude and for Codex.
- **A burst now shows in the burn rate** even when there is only one reading, so a heavy hour is no longer averaged away over the week.
- **The conversion rate (plan % per dollar) is learned properly.** A typed-in reading with almost no local spend no longer sets a huge rate or wipes what was learned, and one-point steps over a few cents no longer push it up: it learns over a stretch of at least 3 points and a real amount of spend. Codex got the same rules.
- **Codex:** a newer typed-in reading is no longer replaced by an older log reading; a new week no longer learns from the old one; extra effort needs a reading from the last 12 hours; an ended 5-hour window is no longer shown as current.
- **A busy settings file is retried** instead of being recorded as applied; two sessions at once can no longer lose a pinned mode or the other plan's shared status (locked updates, Claude and Codex).
- **Fixed in the usage readers:** the same message copied into two files is counted once (largest output); a message straddling the start of a window no longer crashes usage-check; iterations-only usage is priced; the status line ignores a day-old summary; usage-check uses the reset saved by `calibrate`; the model ceiling reads versions from decorated ids (`[1m]`, `-latest`, Bedrock/Vertex); no balance advice when the other plan's percentage is unknown.
- After updating: upload the new plugin, then run `4-CALIBRATE-CLAUDE` once to re-anchor.

## 0.18.1 (Oct 12 2026) — estimates say what they are built on
- **The weekly percentage now says where it comes from.** In the desktop app there is no live reading from Claude, so the plugin estimates: your last real reading plus a conversion rate times new spend. The estimate could drift (one report: 15% shown when the real figure was 4%) and chats repeated it as a fact. `status`/`budget` and the shared Claude/Codex status now show "(estimate: last real reading 4% 9h ago)", so a chat can see how stale it is. Re-run `4-CALIBRATE-CLAUDE` whenever you look at Settings > Usage to re-anchor it.
- **Codex no longer invents "0% used, with surplus" after a weekly reset.** When the last Codex reading belongs to a window that has ended, the week is reported as unknown (not 0%), the surplus/high-effort allowance is not granted from that guess, and the session note does not print a made-up percentage.
- **The Codex doctor no longer cries wolf about your current upload.** The desktop app names the current upload `...uploads`, so name alone is not proof of an old copy. It now warns only when Codex trusts Claude's own hook file (`hooks/hooks.json`) from an uploaded/local copy, which is the case that actually disrupts Codex turns.

## 0.18.0 (Oct 12 2026) — roundtrip audit: 34 problems found and fixed, each with a test that fails without the fix
An independent audit of the whole plugin found 30 problems (and 4 more while fixing). All are fixed in separate commits, each proven by a test that fails on the old code and passes on the new. The ones that matter day to day:
- **Your files are never overwritten when they cannot be read.** Codex `config.toml`, `hooks.json`, `AGENTS.md` and Claude `settings.json` were treated as empty if they were locked or half-edited, then rewritten. Now they are left alone and the reason is shown. Every change keeps a timestamped backup (`<file>.usage-max-backup-<time>`, newest 5) next to the one-time original (`<file>.usage-max-backup`). All edits are atomic and locked against a second session writing at the same moment.
- **Your own model and effort are yours.** When the budget tightens (AMBER/RED) the strict value is written and your own is remembered; when it relaxes your own comes back. A value you change yourself while tightened is never touched again. (Codex and Claude.)
- **Budget numbers.** Codex now remembers which model a conversation uses across checks (spend was priced at the default weight); the hour a plan reading was taken in is no longer counted twice; Codex burn rate ignores spend from before the weekly window; amber no longer jumps to red below the red level; the 5-hour guard needs 10% of the window (25% for RED) before it trusts a projection, so 4% after 7 minutes can no longer force the lowest-quality mode. A mistyped reset time, or one in milliseconds, is rejected or normalised instead of pinning the strict mode. Old readings are labelled old everywhere (status line, usage check, shared Claude/Codex status). A model missing from the price table is priced like its family and listed by `doctor` instead of counting as free.
- **No false alarms.** Dev servers and watchers (`npm run dev`, `--watch`, `serve`) are never wrapped by the output trimmer; the loop warning ignores polling (`gh run view`, `git status`, `kubectl get`…), commands that change files, and long commands that differ; a helper that fails frees its slot at once and parallel starts cannot exceed the cap.
- **Safer notes.** The secret filter now catches Anthropic/OpenAI project keys, `github_pat_`, connection strings with a password, `whsec_`, Google and npm keys and no longer rejects "the token is refreshed hourly"; handoff files, saved command output and the tool log are secret-filtered; notes and the resume point reach the model fenced as data with instruction-like lines removed; `memory sync` never deletes text around odd markers; `remember:` always tells you when it did not save (secret, too long, cannot write) and keeps a second line.
- **Codex trimming is now opt-in** (`{"trimApprove": true}` in `~/.usage-max-codex/config.json`): Codex only accepts a rewritten command if it is also marked pre-approved, which skips Codex's own approval prompt for that command. A half-updated Codex install makes the hook do nothing instead of failing at startup; the Codex TOML editor understands quoted keys, multi-line values and CRLF.
- **Windows.** CI now runs every offline test on Windows too; the kit launchers pick the newest installed plugin folder (not the alphabetically last: `0.9.0` sorted after `0.17.1`); the calibrate launcher no longer passes typed text to a command line; the same folder spelled two ways (case, slashes, links) shares one resume note and one meter offset.
- Smaller: the result cache (`eval-cache`) with no inputs named now keys on the git state and refuses to cache outside git; local dates in notes; UTF-16/BOM/CRLF notes are read; the per-day check uses real elapsed time; calibration prices a message once; spend after a plan reading is counted after it; small status files are written atomically.
- Tests: `usage-max/test/fix.mjs` (one block per finding; `node test/fix.mjs BUG-014` runs one).

## 0.17.1 (Oct 12 2026) — usage-max no longer switches off telemetry or anything else you use
- **Fixed: Remote Control blocked.** The profile wrote `DISABLE_TELEMETRY=1` (and four other switches: feedback survey off, away summary off, goal check-ins off, terminal title off) plus `crossSessionInbound: "hold"` into your Claude settings. Telemetry off was reported to block Remote Control; holding cross-session messages and the away recap are also remote/phone features. usage-max **no longer sets any of them**, and at the next SessionStart it **hands back** the ones it wrote (only while the value is still exactly what it wrote: anything you set yourself is left alone). `usage-max safety` now lists them with who set them; `usage-max safety --fix` hands them back on demand.
- The rule, extended: usage-max does not switch off a product feature or a connection. It only changes model, effort, cache lifetime, and the other cost settings listed by `usage-max safety`.
- Note: a change to settings only reaches sessions that START after it; a session already running keeps what it started with.

## 0.17.0 (Oct 11 2026) — context safety: nothing here may cost you context in the middle of your work
Found by auditing every effect the plugin has on a live session, after a report that conversations were losing context mid-work. The rule from now on: **usage-max never lowers what Claude or Codex can see, never compacts, clears or ends a conversation for you, and never hides output without saving all of it.**
- **Fixed (Codex): the installer had been writing `model_auto_compact_token_limit = 64000`, `tool_output_token_limit = 8000` and `project_doc_max_bytes = 16384` into `~/.codex/config.toml`** in every budget mode. That compacted every chat at 64k tokens and cut AGENTS.md off at 16 KB, which is exactly "Codex forgets parts of my project". Not written any more; at every Codex SessionStart the exact old values are removed (a limit you set yourself is never touched; one you ask for under `tuning` in config.json is still honoured). `codex-diet` no longer recommends them.
- **Fixed (Claude): lean mode in AMBER/RED forced earlier auto-compaction (`autoCompactWindow` 160k/120k), turned off Claude's own auto memory, scheduled tasks (RED) and extended thinking (RED).** It is now **off unless `config.json` has `{"lean": true}`**; at every SessionStart anything it wrote earlier is handed back (your own values stay). The profile no longer halves `BASH_MAX_OUTPUT_LENGTH` (back to the default 30000).
- **Trimmed command output is no longer lost:** the whole output is saved to `~/.usage-max/full-output/` (newest 40, 2 days) and the path is printed after the trim note, in Claude and Codex.
- **The warnings no longer steer you into giving up context.** The idle-cache, big-context and session-cap messages now say what it costs, say nothing is lost, and never say "/clear" or "start fresh" as an instruction.
- **A compaction or a clear can be undone:** a resume note (last asks, files being edited, branch, uncommitted files) is saved at every turn end and **right before every compaction** (new PreCompact hook), carries a pointer to the full word-for-word conversation file, and is shown again right after a compaction and in the next fresh chat.
- **New: `usage-max safety`** lists every setting or behaviour that could shrink, hide or interrupt your work, whether it is on and who set it; `--fix` hands back only what usage-max wrote.
- **Notes are never cut short:** a decision over 300 characters, a key over 60 or a fact over 600 is refused with the exact limit (nothing is saved cut); what is saved is shown whole. Only topic-list pointers are shortened, at a word boundary.
- **New: `usage-max memory suggest`** lists candidate rules and commands found in a repo's own docs, each with its `file:line`; it saves nothing by itself, `--accept 1,3` saves only those you pick.
- Found by an independent review of the above, and fixed with tests: handing lean values back could delete a value you had set yourself when it happened to equal lean's (usage-max now only ever claims a value it actually wrote); Codex `service_tier` was deleted from your config on every mode change (now untouched unless you set one under `modes`); old Codex limits are removed only if usage-max applied a mode on this machine, only at the top of config.toml, written atomically; the pointer to the full conversation could be cut off by a size cap (now the third line) and a compaction could show another session's note (now matched to the conversation); a lost subagent held its slot 20 min (now 6); re-running tests while fixing by `sed`/`git apply` counted as a loop (now progress); the one-time hold on a 400 KB+ read was forgotten in a new session (now remembered for a day); saved command output is owner-only.
- **No permission prompts, and your explicit choices are honoured (your call, Oct 11):** the Codex cross-check and the switch-to-Opus-in-RED are now plain notices (they never ask). A subagent whose model you or Claude asked for explicitly (e.g. `opus`) is no longer rewritten to Sonnet; only your ceiling (nothing above Opus 5.5) and the no-choice default for inheriting subagents still apply.
- Still true and worth knowing: the plugin updates itself from `main` (`autoUpdate`) in new sessions; every hook is fail-open (an error in usage-max never blocks work).

## 0.16.0 (Oct 11 2026) — project memory, a resume point shared by Claude Code and Codex, Codex task packer
- **Project memory** (`usage-max memory ...`). Your big projects get a `.memory/` folder of plain markdown: `decisions.md` (answers given once, never re-asked; `--pin` keeps one in every session) and `topics/<name>.md` (architecture, invariants, gotchas). Each session starts with a small capped block (decisions + topic list, ~2.5k chars); when a prompt mentions a topic, only the matching *sections* are added, once per session. Starting a prompt with `remember: ...` / `from now on ...` saves it with no model call (pasted text is never captured; anything that looks like a password, key or token is refused, and the resume note is redacted the same way). It is Obsidian-compatible (open `.memory/` as a vault, `memory import <vault>` copies notes in) but nothing needs Obsidian. Claude Code and the Codex desktop app/CLI use it through hooks; Codex cloud and the mobile app read it from `AGENTS.md` after `usage-max memory sync` (`sync --check` for CI). Memory is read only from the repo you are in (the search stops at the repo root) and is injected as background data; it is the repo's own text, so open a cloned third-party repo with `config.json {"memory":"off"}` if you do not trust it. Off: `config.json {"memory":"off"}`.
- **Automatic resume point, shared by Claude Code and Codex.** At every Stop (Claude Code, and Codex hooks: desktop app/CLI) a short note is written from the transcript/rollout and git, with no model use: last asks, where it stopped, files edited, branch, uncommitted files, secrets redacted. The next *fresh or cleared* chat in that folder, in either tool, is told once, so you can start in whichever plan has room. One note per folder in `~/.usage-max/resume/`. `usage-max resume` shows it; `usage-max resume --repo` writes a redacted `.codex-tasks/RESUME.md` for Codex cloud/mobile (they read only the repo): commit it and say "Continue from .codex-tasks/RESUME.md". The stale-cache warning (Claude) (Claude) and the long-session warning (Codex) tell you a fresh chat is cheaper. No hook can open a new chat for you; `/clear` (Claude) or a new chat (Codex) is still your one keypress. The Codex rollout reader is tolerant but was written against the format as I know it, not a live install. Off: `config.json {"resume":"off"}`.
- **Codex task packer.** `usage-max pack "<goal>" [--files a,b] [--test cmd] [--save]` writes one scoped prompt (files, done-test, the memory notes that match, one-pass rules, 10-line reply). `--save` stores it as `.codex-tasks/<name>.md`, so from the phone the whole prompt is "Do the task in .codex-tasks/<name>.md". `pack --setup` prints a Codex cloud environment setup script.
- **Huge whole-file Reads** (400 KB+) are refused once with "Grep and read a range"; asking again goes through. Off: `config.json {"readBlock": false}`.
- **`enable-here --lean-auto`** keeps only the plugins you actually used in the last 30 days (refuses with under 5 sessions of history).

- Built on top of 0.14–0.15 (automatic handoff file, Codex guards, long-session warning), not instead of them: with `resume` on, the idle-cache warning points at the shared resume point; with `resume:"off"` the 0.14 handoff file is written as before.

## 0.15.1 (Oct 11 2026) — brakes aimed at what the real report showed
- **Long-session warning gets stricter as the plan runs low:** about 120k tokens when GREEN, 90k in AMBER, 60k in RED. It only ever looks at the current session's own context (never guesses another session's).
- **Parallel-session warning (Codex):** three or more Codex sessions starting in the same folder within 3 minutes are called out once, because each carries its own full context and is billed separately.
- **Doctor accuracy:** the Codex check now names where each usage-max entry in the Codex config comes from and flags only the old UPLOADED copy, not the normal marketplace install; the Claude calibrate hint no longer shows example numbers as if they were yours.

## 0.15.0 (Oct 11 2026) — fixes from the first real Codex report
- **Fixed: `codex diagnose` read the wrong plan window.** It assumed the weekly window is the second slot; in real logs it can be the first. It now finds the weekly window by its length, exactly like the governor, so the weekly-% attribution works (and so does `codex weights`).
- **Fixed: the Windows PowerShell trim test failed for a bad reason.** PowerShell reports exit code 1 for any failing command, trimmed or not. The test now compares against the same command run without trimming, so trim can be switched on when the shells really agree.
- **New: long-session warning in Codex.** The Codex hook reads the real context of the current session and, past about 120k tokens (again at 200k), tells the assistant to say so: a fresh session costs several times less per step. Once per level per session.
- **New in `codex diagnose`:** the starting context of a brand-new session, whether the configured compaction limit is actually holding, a single session or folder that dominates, and a measured list of AGENTS.md weight and visible skills in your busiest folders with what to trim.

## 0.14.2 (Oct 11 2026) — fewer false alarms
- The runaway-loop warning no longer fires on polling (waiting for notifications, tasks, CI or PR status) or on calls that take no input; repeated identical shell or file commands are still caught.

## 0.14.1 (Oct 11 2026) — doctor tells the truth about versions
- `doctor` now says when your build is AHEAD of `main` (unmerged: auto-update could replace it with the older main) instead of "it updates itself".
- `codex doctor` now flags Codex scripts that are older than the plugin (new Codex features are not active) instead of reporting "ok", and `doctor --fix` refreshes them immediately (scripts only; your config.toml and hooks are untouched).

## 0.14.0 (Oct 10 2026) — closing the open items
- **Automatic handoff (Claude).** When the idle-cache warning fires on a big context, usage-max now also writes a handoff file straight from the transcript, with no model call: your recent requests, files changed, open todos, git status and recent commits. `/clear`, then point the new session at the file. Files live in `~/.claude/usage-max/handoffs` and are deleted after 14 days.
- **Codex guards.** The 3rd identical shell command in a row gets a note appended to its output (exit code preserved); a bare `cat <big file>` shows the first 200 lines plus how to read ranges. They never change approval (no permission decision is sent), do nothing on Windows (shell quoting unverified there), and switch off with `USAGE_MAX_GUARDS=off` or `config.json` `"guards":"off"`. Whether your Codex version honours the rewrite is unverified: if it does not, they are harmless no-ops.
- **Codex trim self-test.** Same rule as Claude: a trimmed command re-run within 3 minutes counts against trim, and above 30% after 10 samples trim switches itself off.
- **`/usage-max codex weights`**: learns each model's relative plan cost from your own logs (plan points moved per token), so you do not need the rate card; `--apply` writes them into the Codex governor config. An estimate, needing real movement per model before it reports.

## 0.13.0 (Oct 10 2026) — local-model offload
- **`/usage-max offload`**: bounded text jobs (`summarize`, `commit`, `explain`, `docstrings`, `convert:<format>`) run on a model on YOUR machine (Ollama), so they cost no Claude or Codex usage and the code never leaves the PC. Example: `git diff --staged | usage-max offload commit`.
- Built-in safety: loopback addresses only (refuses anything not 127.0.0.1/localhost), refuses secrets files and text containing private keys or tokens, input capped at 60k characters, output labelled "unverified". It never installs or downloads a model: `offload status` tells you what to install (Ollama, then e.g. `ollama pull qwen2.5-coder:7b`).
- The Claude routing skill and the Codex AGENTS block tell the agent to use it when it reports ready. `savings` shows jobs run and the input tokens kept off your plan (an estimate: characters/4).
- Tested against a stub Ollama server only; not yet tried with a real model.

## 0.12.0 (Oct 10 2026) — where Codex usage really goes, and four new brakes
- **`/usage-max codex diagnose`** (also summarised in `savings`): Codex logs the plan's real rate-limit percentages on every call, so the weekly % that moved between two calls is attributed to the session, model/effort, folder, day and start type (interactive vs `codex exec`/automation) that made it. Measured, not estimated; resets are ignored. Plus token mix (fresh vs cached input, output, reasoning), context size per call, and plain "what stands out" findings.
- **Cross-agent gate.** Claude calling Codex (`codex exec` / `codex review`, which is what the codex-review and codex-dispatch plugins run) spends your Codex plan. A new Claude hook counts those calls and ASKS first (never auto-approves) when Codex is RED or when a session is on its 3rd+ Codex call in an hour (each review round re-sends the plan/diff).
- **Script-first hint.** The same edit made in 4 different files triggers one nudge: write one script/codemod for the rest instead of one model turn per file.
- **Session cap (`/usage-max cap <usd>|off`).** Optional per-session spend cap at list price; warns at 80% and 100% so one runaway session cannot eat the week. Off by default; nothing is blocked.
- Digest counts for all of these.

## 0.11.0 (Oct 10 2026) — the open research items
- **Trim self-test (`/usage-max trim`).** The Claude shell-output trim now measures itself: bytes removed, and how often the same command was re-run within 3 minutes of a trim (a re-run means the model needed what was cut). Above 30% re-runs, after 10 samples, trim switches itself off; `usage-max trim on` re-enables. Shown in `savings`. Independent tests of output trimming disagree with vendor claims, so this decides on your own data.
- **Description budgets, opt-in (`/usage-max budgets on|off`).** Smaller skill-list and MCP description budgets (`SLASH_COMMAND_TOOL_CHAR_BUDGET` 4000, `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` 1000) to shrink the first turn. Off by default because rarely used skills may trigger less; only keys it wrote are ever removed.
- **Cheap-first cascade.** The routing skill and the Codex block now say: start mechanical work on the cheapest tier, let tests/linter judge, retry once with the error, then escalate one step; hard or unverifiable work starts higher.

## 0.10.0 (Oct 10 2026) — burn alarm, background-spend switches, instruction lint
- **`/usage-max anomaly`** (also shown in `savings`): compares the last 3 hours with your own hourly median (needs about a day of history) and, when it is 3x higher, names the biggest contributor (session, model, effort). Claude in list-price dollars, Codex in tokens (Codex logs carry no price). Catches loops, stuck tasks, Fast mode or a plugin that started spending, on either plan.
- **Lean mode now also switches off background spend while tightening:** auto memory in AMBER and RED, scheduled tasks in RED (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, `CLAUDE_CODE_DISABLE_CRON`). GREEN removes them again, and a value you set yourself is never touched.
- **`context`** also flags instruction files over about 200 lines (Anthropic's guidance) and warns against unpruned `/init` output.
- **`/usage-max crosscheck <ccusage.json>`**: optional, offline comparison with a ccusage export you made yourself. usage-max never runs ccusage.
- **Subagent cache lifetime** set to 5m in both profiles (`CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`), the cold-cache warning now says resuming a big old session is the costliest move, and `context` explains that memory plugins can spend tokens in the background.
- Research and build plan: `docs/RESEARCH-usage-reduction.md`.

## 0.9.1 (Oct 10 2026) — one savings report for both plans
- **`/usage-max savings [--days N]`** shows Claude and Codex side by side with the same labels: `measured` (read from your logs), `estimate` (a stated counterfactual, e.g. what subagent work would have cost on the main model) and `what-if` (a lever, not a saving). Neither plan is favoured.
- Each side ends with "more:" hints computed from your own numbers: Claude delegation share and main-model spend; Codex high/xhigh effort share and tool-output bytes per turn.
- Honest limit: there is no "without usage-max" run to compare against, so totals are workload-dependent; only the labelled counterfactuals are estimates.

## 0.9.0 (Oct 10 2026) — lean mode and burn visibility
- **Lean RED/AMBER.** Besides model and effort, tightening now caps context growth (`autoCompactWindow` 160k AMBER / 120k RED) and turns off always-on thinking in RED. Back in GREEN your own values are left alone and anything usage-max wrote is removed.
- **Time to empty.** `/usage-max status` and the budget directive say "at this pace the plan runs out in ~Xh, before the reset in Yh" (only from real plan-% data, only when it beats the reset).
- **Lean plugin sets.** `usage-max enable-here [dir] --lean a,b` makes one repo load only the plugins you name (everything else you have installed is off for that repo; explicit choices already in the file are kept). Plugins synced from your claude.ai account are turned off in claude.ai instead.
- **Cheaper first pass.** The routing rules now say: if a task needs more than ~3 files or ~300 lines read, send the Haiku scout first and read only the ranges it returns.
- **Background-burn check.** `doctor` lists scheduled claude/codex jobs (cron, Task Scheduler) and headless runs (`claude -p`, `codex exec`) that keep spending while you are away. Report only; `rescue halt` lists how to stop them.

## 0.8.0 (Oct 10 2026) — session guards (Claude Code)
Claude Code only; they do nothing inside Codex. Every guard is silent unless it has something to say, and fails open.
- **Stale-cache warning.** If a session sat idle past the cache lifetime and its context is 40k+ tokens, you get a one-line note (shown to you, costs no model tokens): continuing re-bills the whole context at ~10x a warm turn; hand off and start fresh is cheaper.
- **Big-context nudge** (150k+, then every +40k): reminds you to `/compact` or hand off at a natural break.
- **Runaway-loop detector.** The same tool call 3 times with no edit in between tells Claude to change approach; 6 times tells it to stop and ask you.
- **Subagent cap.** At most 4 parallel subagents (5 in surplus, 2 AMBER, 1 RED); each pays its own full startup context. Override: `"maxSubagents": N` in the usage-max `config.json`.
- **Smart Read hints.** Re-reading a file that has not changed and is already in context, or reading a 40KB+ file whole, adds a one-line hint for Claude. It never blocks or changes the read, never decides permissions, and forgets what was read after `/compact` or `/clear`.
- `/usage-max context`: what CLAUDE.md / AGENTS.md and their `@imports` cost on every turn, with size and staleness suggestions. Nothing is deleted; `context --archive <file>` moves one file to `.usage-max-archive/` (move it back to undo).
- `/usage-max digest`: counts of what the guards did (plus Codex measured trim savings). Shown once a day at session start if non-empty.
- `/usage-max queue add|list|next|clear`: low-priority tasks Claude offers when the plan shows SURPLUS.
- `/usage-max chat-prefs`: paste-once standing instructions for Claude.ai, Cowork and ChatGPT (chats have no hooks, so this is the no-reminder route).

## 0.7.0 (Oct 10 2026) — Codex: Windows-safe trimming, savings report, backup/restore
- **Trimming on Windows** now works through a Node wrapper (`node ".../run-trimmed.mjs" run npm test`). The command stays readable, so Codex's approval and auto-review see the real command. Only plain words are wrapped; anything with pipes, redirects, chaining, quotes, globs, `--json`/`--reporter`/`-q`/`--no-trim` is left untouched. Exit codes are forwarded. On Windows it stays OFF until you run `node <bin>/scripts/codex-governor.mjs selftest-trim` once (it proves PowerShell and cmd on your PC).
- **Rollback:** set `USAGE_MAX_TRIM=off`, or `"trim":"off"` in the Codex usage-max `config.json`.
- **`codex-governor savings`** (read-only): measured numbers (sessions, turns, tool-output bytes, trim rewrites and bytes removed) kept separate from estimates, split before/after install. No invented provider numbers.
- **`codex-governor backup` / `restore --check` / `restore --apply`**: timestamped, never overwritten, sha256 manifest, private file modes; restore takes a pre-restore backup first. After a restore, restart the Codex app (and re-trust hooks in the CLI `/hooks` if it asks).
- Claude hooks are unchanged.

## 0.6.4 (Oct 10 2026)
- **`/usage-max` no longer asks permission.** The command now pre-approves exactly its own script (`allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-max.mjs":*)`, nothing broader) and runs it inline before the model starts, so it also costs one model turn instead of two. A live test (`test/live.mjs`) fails if a permission prompt ever comes back.
- Plain English after the command (for example `/usage-max as the new version`) shows the status with a short note instead of failing; cloud sessions no longer say "profile not applied" (it cannot apply there).

## 0.6.3 (Oct 10 2026) — "/usage-max is not available in my cloud sessions or Cowork"
- Cause (checked in a live cloud container): cloud/desktop sessions and Cowork only see plugins in your claude.ai plugin list, and the old upload had been removed with no new one there; sessions also freeze their plugin list when they start.
- **New: `/usage-max enable-here [dir]`** writes the repo's `.claude/settings.json` (GitHub marketplace pinned to `main`, auto-update, plugin enabled) without touching anything else (an explicit "off" is respected). Commit it and every session on that repo, cloud or terminal, loads usage-max with no upload. Verified headless in an isolated config with nothing installed. This repo ships with it.
- `status`/`doctor` say plainly when you are in a cloud session what works there (routing, Sonnet cap) and what cannot (no plan %, nothing persists): plan tracking belongs on your PC.
- Cowork has no repo to carry settings; it needs the uploaded plugin zip (not tested from here).

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
