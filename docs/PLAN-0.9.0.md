# usage-max 0.9.0 plan (written Oct 10 2026, user is tired of running out of usage)

Read this first in a new session, then `handoff.md` (history) and `usage-max/README.md` (changelog). Status lines below are updated as items land.
User facts: Claude plan ~67% weekly at 36h to reset (budget RED, burn 6.5x sustainable); Codex Pro at 77% (resets Oct 14); Windows PC; wants everything automatic, no manual reminding, no permission prompts, and every change proven (suites + `node usage-max/test/live.mjs`) before merge. Merging PRs is MY job, not theirs. Branch: claude/usage-routing-analysis-oqqqjr (restart from origin/main after each merge). Sessions are expensive: stay on Sonnet, no fan-outs, read only what you need.

## Items
4. **Lean RED mode.** In AMBER/RED the governor (scripts/governor.mjs patchModel/applySettings, ownership via applied.json, force only in AMBER/RED) also sets a lower thinking effort and `autoCompactWindow` (RED 120000, AMBER 160000) so context cannot balloon; GREEN hands the user's own values back. Test in test/new.mjs.
5. **Time-to-empty line.** `usage-max status` and the UserPromptSubmit directive state "at this pace you hit 100% in Xh; reset in Yh" (only from real plan-% data; never invent). Pure function + test.
6. **Lean plugin sets per project.** `usage-max enable-here --lean <plugin,...>` writes project `.claude/settings.json` with only those plugins true (others false). Never overwrites existing keys. Doc caveat: plugins synced from the user's claude.ai account are disabled in claude.ai, not here.
7. **Cheaper first pass.** Routing text + scout default: exploration/read/search goes to usage-max-scout (Haiku); main model only reviews. Edit skills/routing/SKILL.md and the SessionStart rules line; keep within the existing token budget of the rules (~150 tokens).
8. **Background-burn check.** `usage-max doctor` lists things that keep spending while away: scheduled routines/loops (local: `crontab`, Windows `schtasks` entries containing "claude"), `claude agents` background rows if the CLI exposes them, Codex `codex exec` processes. Report only; `rescue halt` prints the stop steps.

## Done criteria
All suites green (node usage-max/scripts/check.mjs, usage-max/test/run.mjs, new.mjs, guard.mjs, usage-max/codex/test/run.mjs), live.mjs green, version 0.9.0 in the three manifests (.claude-plugin/marketplace.json, usage-max/.claude-plugin/plugin.json, usage-max/.codex-plugin/plugin.json), README changelog entry, handoff.md note, PR -> CI green on current head -> merge with expectedHeadSha -> rebuild kit from a clean worktree of origin/main (`python3 install/build-kit.py --out <dir>`) and SendUserFile usage-max-desktop.zip + usage-max-plugin-0.9.0.zip.

## Status
- [x] 4  - [x] 5  - [x] 6  - [x] 7  - [x] 8   (implemented in 0.9.0; tests in usage-max/test/guard.mjs). Open ideas not built: Codex-side loop/Read guards; auto-handoff at cold cache.
