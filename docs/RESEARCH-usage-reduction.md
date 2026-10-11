# Cutting Claude and Codex/ChatGPT usage: research and build plan (Oct 10 2026)

Four scouts searched the web (Claude levers, Codex/ChatGPT levers, cross-tool research, existing tools). Evidence grades used below:
- **V** = verified by me against the official page fetched this session (code.claude.com env-vars, costs, prompt-caching, model-config).
- **C** = claimed by a vendor, blog or forum, not verified. OpenAI docs, arXiv, GitHub and JetBrains were not reachable from this container, so every Codex-specific and paper figure is **C**.
- Neither provider is favoured. Each item says which plan it helps.

## 1. What the evidence says, in one paragraph
Usage is mostly **context re-read on every turn**, not output. Biggest verified drivers: cold prompt cache after idle gaps, long sessions, big always-loaded context (CLAUDE.md/AGENTS.md, skill lists, MCP tool schemas, plugins), high model/effort for routine work, and background activity (loops, auto memory, check-ins). Output-shaving tricks (terse "caveman" styles) touch ~1-2.5% of spend (C). Shell-output trimming is **contested**: one tool claims 60-90% of command output, but a reported JetBrains A/B found +7.6% cost at low effort and ~0% at high effort (C), and a Codex write-up argues cache traffic dominates (C). So usage-max must measure its own trim, not assume it.

## 2. Already in usage-max (do not rebuild)
Claude: governor on plan %, model/effort/autoCompactWindow tightening, promptCacheTtl profile, cold-cache and loop guards, Read hints, compact nudge, subagent cap, bash trim, context report, plugin diet, lean plugin sets, background-burn check, time-to-empty, savings report.
Codex: governor, model_reasoning_effort, service_tier, tool_output_token_limit, model_auto_compact_token_limit, AGENTS.md block, Windows-safe trim, savings, backup/restore.

## 3. Gaps worth building (ranked by expected payoff vs effort)

| # | Idea | Plan | Evidence | Effort | Notes |
|---|---|---|---|---|---|
| 1 | **Burn-anomaly alarm**: flag when tokens/turn or $/hour jumps well above your own 7-day median (runaway loop, bug, a plugin that started spending) and name the likely cause | Both | Both providers had acknowledged quota-drain incidents (C); `/usage` attribution is official (V) | Low-Med | Uses data we already read; no new risk |
| 2 | **Self-measured trim A/B**: `savings` compares per-turn cost for sessions with trim on vs off and turns trim off by default if it does not help; always keep full output on failures | Both | RTK A/B contradicts vendor claims (C) | Low | Makes our own claim honest |
| 3 | **Background-spend switches** in the strict profile (opt-in): `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CRON=1`, `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, goal check-ins (already) | Claude | V (env-vars page) | Low | Not applied today |
| 4 | **Skill-list and MCP description budgets**: set `SLASH_COMMAND_TOOL_CHAR_BUDGET` (default 1% of context, 8k fallback) and `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` (default 2048) lower; diet shows the first-turn tokens saved | Claude | V exist; effect size not measured. Risk: skills trigger less often | Low | Your first turn was ~81k tokens; this targets exactly that |
| 5 | **Subagent cache TTL**: `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` (5m/1h; v2.1.257+ style gating) matched to how you delegate | Claude | V | Low | Short subagent bursts waste 1h writes |
| 6 | **Instruction-file lint with numbers**: warn above ~200 lines/~2-3k tokens for CLAUDE.md and AGENTS.md; suggest moving workflow text into skills; never auto-generate with `/init` unpruned | Both | Official ~200 lines (V). ETH Zurich ICLR 2026 paper: context files raised cost >20% with no success gain (C) | Low | `context` already measures; add thresholds |
| 7 | **Cheap-first cascade with a verifier**: scout/worker first, escalate to the stronger model only when tests fail or review rejects | Both | FrugalGPT/RouteLLM show large savings in other settings (C); not tested on agentic coding | Med | Prose change to routing + a Codex equivalent |
| 8 | **Resume hygiene advice**: prefer fresh session + handoff over resuming a large cold session; for Codex use `resume --last` only when warm | Both | Cold-cache cost (V for Claude); Codex resume claim (C) | Low | Extend the cold-cache guard text |
| 9 | **Memory-plugin accounting**: flag plugins that spend tokens in the background (e.g. claude-mem compresses via the Agent SDK) in `diet` | Claude | C (project docs) | Low | Report only |
| 10 | **Plan-% cross-check** against ccusage / `@ccusage/codex` totals to validate our own meter | Both | Tools exist (C) | Low | Optional doctor check; never required |

## 4. Looked at and not recommended by default
- **Terse-output skills (caveman etc.)**: output is ~1-2.5% of spend (C); clarity risk.
- **Proxies/gateways (Headroom, LunaRoute, claude-code-router, Bifrost, LiteLLM)**: see all prompts, add a failure point, and plan limits cover Claude only so routing off-Claude is a different cost model. Opt-in only.
- **Sandboxed-execute MCPs (context-mode)**: promising (98% claimed, self-reported), but license conflicts across listings (ELv2 vs MIT), runs code, call throttles. Evaluate separately.
- **LSP/semantic search (Serena, claude-context)**: a preliminary study found LSP-only used ~6% more tokens than grep for localization (C); vendor claims are self-run. Opt-in for large typed repos.
- **Observation masking** (replace stale tool outputs with placeholders; JetBrains reports ~halved cost at equal solve rate, C): strong evidence but **not implementable as a hook today**. Claude/Codex hooks cannot rewrite past tool results. Closest feasible: earlier compaction (`autoCompactWindow`) and focused `/compact` instructions, which usage-max already tunes.
- **Downgrading Claude Code versions / unofficial patches** from forums: security risk, unverified.
- **Prompt compressors (LLMLingua)**: lossy on code; research benchmarks, not agent runs.

## 5. Codex/ChatGPT specific findings (all C: OpenAI pages unreachable here)
- Local messages and cloud tasks share a 5-hour window plus weekly caps; usage depends on model, task size, context size, reasoning, speed and tools.
- **Fast mode** reportedly costs 2.5x credits (GPT-5.5) for ~1.5x speed; one informal test measured no speedup. usage-max already manages `service_tier`; confirm it forces standard outside RED-free periods.
- Lower reasoning effort, cheaper default model plus a `heavy` profile, fresh session per task, narrow scope, fewer MCP servers, lean AGENTS.md (a study reports ~16.6% median output-token reduction, attribution disputed), tune `tool_output_token_limit` (~16-24k; sources conflict on 8-12k).
- Not found anywhere: whether ChatGPT custom instructions, memory, Projects, deep research or agent mode count against Codex limits. Needs the official help article; ask the user to check **Settings > Usage** in the ChatGPT app.
- No supported Codex usage API was found; a GitHub issue says the CLI uses an undocumented endpoint. Keep reading local rollout files only.

## 6. Existing tools worth borrowing from (ideas, not dependencies)
ccusage (+ Codex companion) for 5-hour block math; Claude-Code-Usage-Monitor for P90 plan detection (its plan presets are estimates, not official); claude-powerline for a cache-TTL segment; codex-ratelimit / codex-vitals for reading Codex limit state; TokenWise skill for per-task-class routing tables and A/B logging; awesome-claude-code(-hooks) as a discovery index. Supply-chain cautions: name collisions (ccusage npm vs PyPI, rtk vs "Rust Type Kit"), forks with copied READMEs, unpinned `npx -y`/`uvx` installs. Pin versions if anything is ever bundled.

## 7. Recommended 0.10 scope
Build #1, #2, #3, #4, #5, #6 (all low effort, mostly settings plus reports), then #8 and #9. Hold #7 until #2's measurement exists. Every item ships with a test and a line in `savings` saying whether it was measured.

## 8. Open questions for the user
1. Which plan runs out first in a normal week? (Decides which side gets #1 first.)
2. OK to make the strict-profile switches in #3 and #4 apply by default, or keep them opt-in?
3. Allow outside tools (ccusage) as an optional cross-check?
