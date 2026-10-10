import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "umg-")); process.env.USAGE_MAX_HOME = home;
const dir = path.join(home, ".claude", "usage-max"); fs.mkdirSync(dir, { recursive: true });
const G = await import(pathToFileURL(path.join(root, "scripts/guard.mjs")).href);
const { scan, archive } = await import(pathToFileURL(path.join(root, "scripts/ctxfiles.mjs")).href);
let n = 0; const t = async (name, f) => { await f(); n++; console.log("ok -", name); };
const tr = path.join(home, "t.jsonl"); const ctxLine = (c) => JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: c } } }) + "\n";
await t("lastContext reads the newest usage", () => { fs.writeFileSync(tr, ctxLine(1000) + ctxLine(90000)); assert.equal(G.lastContext(tr), 90010); assert.equal(G.lastContext("/nope"), null); });
await t("cold cache warns only for a big context after the TTL", () => {
  G.promptCheck(dir, "s1", { now: 1e9, ctx: 90000 });
  assert.equal(G.promptCheck(dir, "s1", { now: 1e9 + 60e3, ctx: 90000 }), null, "warm");
  assert.match(G.promptCheck(dir, "s1", { now: 1e9 + 60e3 + 400e3, ctx: 90000 }), /idle 7 min.*handoff/s);
  G.promptCheck(dir, "s2", { now: 1e9, ctx: 5000 }); assert.equal(G.promptCheck(dir, "s2", { now: 1e9 + 9e6, ctx: 5000 }), null, "small context: nothing to save");
  G.promptCheck(dir, "s3", { now: 1e9, ctx: 90000 }); assert.equal(G.promptCheck(dir, "s3", { now: 1e9 + 9e6, ctx: 90000, ttlMs: 3600e3 * 5 }), null, "within a long TTL");
});
await t("big-context compact nudge fires once per +40k", () => {
  assert.match(G.promptCheck(dir, "c1", { now: 1, ctx: 160000 }), /compact/); assert.equal(G.promptCheck(dir, "c1", { now: 2, ctx: 170000 }), null);
  assert.match(G.promptCheck(dir, "c1", { now: 3, ctx: 205000 }), /compact/); assert.equal(G.promptCheck(dir, "c1", { now: 4, ctx: 40000 }), null);
  assert.match(G.promptCheck(dir, "c1", { now: 5, ctx: 160000 }), /compact/, "after compaction it can nudge again");
});
await t("loop: 3rd identical call warns, 6th escalates, an edit resets, different calls do not warn", () => {
  const b = { command: "npm test" }; assert.equal(G.loopCheck(dir, "l1", "Bash", b), null); assert.equal(G.loopCheck(dir, "l1", "Bash", b), null);
  assert.match(G.loopCheck(dir, "l1", "Bash", b).additionalContext, /3 times/); assert.equal(G.loopCheck(dir, "l1", "Bash", b), null);
  G.loopCheck(dir, "l1", "Bash", b); const r = G.loopCheck(dir, "l1", "Bash", b); assert.match(r.additionalContext, /Stop now/); assert.ok(r.systemMessage);
  G.loopCheck(dir, "l2", "Bash", b); G.loopCheck(dir, "l2", "Bash", b); G.loopCheck(dir, "l2", "Edit", { file_path: "a" }); assert.equal(G.loopCheck(dir, "l2", "Bash", b), null, "edit between = progress");
  for (let i = 0; i < 8; i++) assert.equal(G.loopCheck(dir, "l3", "Bash", { command: "echo " + i }), null);
});
await t("Read hints: first big read, then unchanged re-read; ranged reads and changed files are quiet; reset forgets", () => {
  const big = path.join(home, "big.txt"), small = path.join(home, "small.txt"); fs.writeFileSync(big, "x".repeat(60000)); fs.writeFileSync(small, "hi");
  assert.match(G.readCheck(dir, "r1", { file_path: big }), /60 KB.*Grep/); assert.match(G.readCheck(dir, "r1", { file_path: big }), /already read in full/);
  assert.equal(G.readCheck(dir, "r1", { file_path: big, offset: 5, limit: 20 }), null);
  assert.equal(G.readCheck(dir, "r1", { file_path: small }), null); assert.match(G.readCheck(dir, "r1", { file_path: small }), /already read/);
  fs.writeFileSync(small, "changed content"); assert.equal(G.readCheck(dir, "r1", { file_path: small }), null, "file changed: read it");
  G.resetReads(dir, "r1"); assert.equal(G.readCheck(dir, "r1", { file_path: small }), null, "after compact/clear it is not in context any more");
  assert.equal(G.readCheck(dir, "r1", { file_path: "/does/not/exist" }), null);
  const part = path.join(home, "part.txt"); fs.writeFileSync(part, "y".repeat(500)); G.readCheck(dir, "r2", { file_path: part, offset: 1, limit: 3 }); assert.equal(G.readCheck(dir, "r2", { file_path: part }), null, "a ranged read is not a full read");
});
await t("subagent cap by mode, release, expiry, config override", () => {
  const f = (m, id, now) => G.agentStart(dir, id, m, false, now); fs.rmSync(path.join(dir, "inflight.json"), { force: true });
  assert.equal(f("red", "a", 1000), null); assert.match(f("red", "b", 1001).deny, /cap 1 in RED/); G.agentEnd(dir, "a"); assert.equal(f("red", "b", 1002), null);
  fs.rmSync(path.join(dir, "inflight.json")); for (const id of "1234") assert.equal(f("green", id, 5000), null); assert.ok(f("green", "5", 5001).deny);
  assert.equal(f("green", "5", 5000 + 21 * 60e3), null, "stale entries expire (a crashed subagent never blocks you forever)");
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ maxSubagents: 8 })); fs.rmSync(path.join(dir, "inflight.json")); for (let i = 0; i < 8; i++) assert.equal(f("red", "x" + i, 9000), null); fs.rmSync(path.join(dir, "config.json"));
});
await t("digest counts and queue", () => {
  assert.ok(G.digest(dir).lines.length > 0); G.queueOp(dir, "add", "tidy docs"); G.queueOp(dir, "add", "rename x"); assert.equal(G.queueOp(dir, "next").taken.text, "tidy docs"); assert.equal(G.loadQueue(dir).length, 1); assert.ok(G.queueOp(dir, "add", "").error); G.queueOp(dir, "clear"); assert.equal(G.loadQueue(dir).length, 0);
});
await t("ctxfiles: follows @imports, flags big and stale, archive is reversible and never deletes", () => {
  const p = path.join(home, "proj"); fs.mkdirSync(path.join(p, "docs"), { recursive: true });
  fs.writeFileSync(path.join(p, "CLAUDE.md"), "rules\n@docs/old.md\n@docs/huge.md\n"); fs.writeFileSync(path.join(p, "docs/old.md"), "o".repeat(2000)); fs.writeFileSync(path.join(p, "docs/huge.md"), "h".repeat(20000));
  const old = new Date(Date.now() - 200 * 864e5); fs.utimesSync(path.join(p, "docs/old.md"), old, old);
  const r = scan({ home, cwd: p }); assert.equal(r.rows.filter((x) => x.file.startsWith(p)).length, 3);
  assert.ok(r.advice.some((a) => /old\.md/.test(a.file) && /untouched/.test(a.why))); assert.ok(r.advice.some((a) => /huge\.md/.test(a.file) && /every turn/.test(a.why)));
  const a = archive(path.join(p, "docs/old.md")); assert.ok(fs.existsSync(a.to) && !fs.existsSync(path.join(p, "docs/old.md"))); assert.ok(archive(path.join(p, "nope.md")).error);
});
await t("hook entry: silent + exit 0 on garbage, silent under Codex, Read hint through the real hook", () => {
  const run = (input, env = {}) => spawnSync("node", [path.join(root, "hooks/guard.mjs")], { input, encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, ...env } });
  let r = run("not json"); assert.equal(r.status, 0); assert.equal(r.stdout, "");
  const big = path.join(home, "hook-big.txt"); fs.writeFileSync(big, "z".repeat(50000));
  r = run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", session_id: "h1", tool_input: { file_path: big } }), { USAGE_MAX_HOST: "claude" }); assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout); assert.equal(o.hookSpecificOutput.hookEventName, "PreToolUse"); assert.ok(!("permissionDecision" in o.hookSpecificOutput), "a hint never decides permissions"); assert.match(o.hookSpecificOutput.additionalContext, /50 KB/);
  r = run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", session_id: "h2", turn_id: "x", tool_input: { file_path: big } })); assert.equal(r.stdout, "", "Codex payload: do nothing");
});
const GV = await import(pathToFileURL(path.join(root, "scripts/governor.mjs")).href);
const BG = await import(pathToFileURL(path.join(root, "scripts/background.mjs")).href);
await t("lean mode: RED caps compaction and thinking, keeps going back to the user's values in GREEN", () => {
  const ap = {}; const s = { model: "x" };
  assert.equal(GV.patchLean(s, "red", ap), true); assert.equal(s.autoCompactWindow, 120000); assert.equal(s.alwaysThinkingEnabled, false);
  assert.equal(GV.patchLean(s, "amber", ap), true); assert.equal(s.autoCompactWindow, 160000); assert.ok(!("alwaysThinkingEnabled" in s), "amber lifts the thinking cap");
  assert.equal(GV.patchLean(s, "green", ap), true); assert.ok(!("autoCompactWindow" in s)); assert.equal(s.model, "x");
  const mine = { autoCompactWindow: 300000 }; GV.patchLean(mine, "green", {}); assert.equal(mine.autoCompactWindow, 300000, "a value you set in GREEN is never touched");
  const mine2 = { alwaysThinkingEnabled: true }; GV.patchLean(mine2, "red", {}); assert.equal(mine2.alwaysThinkingEnabled, false, "RED may tighten your value");
  GV.patchLean(mine2, "green", {}); assert.equal(mine2.alwaysThinkingEnabled, false, "...and green does not delete what it did not own");
});
await t("time to empty only from real data and only when it beats the reset", () => {
  assert.equal(GV.timeToEmpty({ estPct: 67, ratePerHour: 2, hoursLeft: 36, rateSource: "plan %" }).hours, 16.5);
  assert.equal(GV.timeToEmpty({ estPct: 67, ratePerHour: 0.5, hoursLeft: 36, rateSource: "plan %" }), null, "lasts to reset");
  assert.equal(GV.timeToEmpty({ estPct: 67, ratePerHour: 2, hoursLeft: 36, rateSource: "none yet" }), null);
  assert.equal(GV.timeToEmpty({ estPct: null, ratePerHour: 2, hoursLeft: 36 }), null);
});
await t("background-burn parsers flag scheduled/headless claude+codex only", () => {
  assert.equal(BG.parseCron("# c\n0 * * * * claude -p 'x'\n5 * * * * backup.sh\n").length, 1);
  assert.equal(BG.parseSchtasks('"PC","\\NightlyClaude","N/A"\n"PC","\\Other","x"\n')[0].text, "\\NightlyClaude");
  const ps = "  10 01:00 claude -p do stuff\n  11 02:00 /usr/bin/claude --resume\n  12 00:30 codex exec fix\n  13 00:10 /bin/sh -c ln -sf /opt/claude-code/bin/claude x\n  99 00:01 node usage-max/scripts/background.mjs claude -p";
  assert.deepEqual(BG.parsePs(ps, 1).map((x) => x.text.slice(0, 6)), ["pid 10", "pid 12"]);
});
await t("enable-here --lean keeps only the named plugins on and never overwrites", () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "umlean-")), proj = path.join(h, "repo"); fs.mkdirSync(path.join(h, ".claude"), { recursive: true }); fs.mkdirSync(proj);
  fs.writeFileSync(path.join(h, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "a@m": true, "b@m": true, "c@m": true } }));
  const run = () => spawnSync("node", [path.join(root, "scripts/usage-max.mjs"), "enable-here", proj, "--lean", "a"], { env: { ...process.env, USAGE_MAX_HOME: h }, encoding: "utf8" });
  assert.equal(run().status, 0); const e = JSON.parse(fs.readFileSync(path.join(proj, ".claude/settings.json"))).enabledPlugins;
  assert.equal(e["b@m"], false); assert.equal(e["c@m"], false); assert.ok(e["a@m"] !== false); assert.equal(e["usage-max@eric-plugins"], true);
  e["b@m"] = true; fs.writeFileSync(path.join(proj, ".claude/settings.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(proj, ".claude/settings.json"))), enabledPlugins: e })); run();
  assert.equal(JSON.parse(fs.readFileSync(path.join(proj, ".claude/settings.json"))).enabledPlugins["b@m"], true, "an explicit choice in the repo is kept");
});
await t("claude savings: dedupes by message id, splits hub vs subagent, prices delegation against the hub model", () => {
  const proj = path.join(home, "sv", "p1"); fs.mkdirSync(path.join(proj, "sess", "subagents"), { recursive: true });
  const rec = (id, model, out, ts) => JSON.stringify({ type: "assistant", timestamp: ts, message: { id, model, usage: { input_tokens: 1000, output_tokens: out, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }) + "\n";
  const ts = new Date().toISOString();
  fs.writeFileSync(path.join(proj, "main.jsonl"), rec("m1", "claude-opus-5-5", 1000, ts) + rec("m1", "claude-opus-5-5", 1000, ts));
  fs.writeFileSync(path.join(proj, "sess", "subagents", "a.jsonl"), rec("s1", "claude-haiku-5-5", 1000, ts));
  return import(pathToFileURL(path.join(root, "scripts/savings.mjs")).href).then(async ({ claudeSavings, formatClaude }) => {
    const r = await claudeSavings({ dir: path.join(home, "sv"), days: 1 });
    assert.equal(r.turns, 2, "duplicate record counted once"); assert.equal(r.subTurns, 1); assert.ok(r.counterfactual.ifOnHub > r.subCost && r.counterfactual.saved > 0);
    assert.match(formatClaude(r), /estimate\s+delegation/); assert.match(formatClaude(r), /what-if/);
    assert.match(formatClaude(await claudeSavings({ dir: path.join(home, "none"), days: 1 })), /no Claude transcripts/);
  });
});
await t("anomaly: needs a baseline, flags a 3x burst, names the culprit, stays quiet when normal", async () => {
  const A = await import(pathToFileURL(path.join(root, "scripts/anomaly.mjs")).href); const now = 1e12, H = 36e5;
  const base = []; for (let h = 4; h < 60; h++) base.push({ t: now - h * H, v: 1, who: "old" });
  assert.equal(A.detect(base.slice(0, 5), { now }), null, "too little history: no verdict");
  const burst = [...base, { t: now - H, v: 9, who: "loopy session" }, { t: now - 2 * H, v: 3, who: "other" }];
  const r = A.detect(burst, { now }); assert.equal(r.anomalous, true); assert.equal(r.top.who, "loopy session"); assert.match(A.format("Codex", "tok", r), /BURNING FAST.*loopy session/);
  const calm = [...base, { t: now - H, v: 1, who: "x" }]; assert.equal(A.detect(calm, { now }).anomalous, false); assert.match(A.format("Claude", "$", A.detect(calm, { now })), /normal/);
});
await t("lean env switches: auto memory off in AMBER/RED, cron off in RED, removed in GREEN only when still ours", () => {
  const s = {}, ap = {}; GV.patchLean(s, "red", ap); assert.equal(s.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1"); assert.equal(s.env.CLAUDE_CODE_DISABLE_CRON, "1");
  GV.patchLean(s, "amber", ap); assert.equal(s.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1"); assert.ok(!("CLAUDE_CODE_DISABLE_CRON" in s.env), "cron comes back in AMBER");
  s.env.KEEP = "1"; GV.patchLean(s, "green", ap); assert.ok(!("CLAUDE_CODE_DISABLE_AUTO_MEMORY" in s.env)); assert.equal(s.env.KEEP, "1", "other env keys untouched");
  const mine = { env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" } }; GV.patchLean(mine, "green", {}); assert.equal(mine.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "0", "your own value is never removed");
});
await t("context lint flags an instruction file over 200 lines", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-")); fs.writeFileSync(path.join(d, "CLAUDE.md"), "- rule\n".repeat(250));
  const r = scan({ home: d, cwd: d }); assert.ok(r.advice.some((a) => /250 lines|lines \(Anthropic/.test(a.why)));
});
await t("trim self-test: counts bytes, flags retries, switches itself off, and can be turned back on", async () => {
  const T = await import(pathToFileURL(path.join(root, "scripts/trimtest.mjs")).href); const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-"));
  assert.match(T.report(d), /no trimmed commands/); T.recordBytes(d, 4000, 1000);
  for (let i = 0; i < 9; i++) T.recordRewrite(d, "npm test " + i, 1000 + i); assert.equal(T.isDisabled(d), false, "below the sample size nothing switches off");
  const r = T.recordRewrite(d, "npm test 0", 2000); assert.equal(r.retry, true); assert.equal(T.isDisabled(d), false, "1 retry in 10 is fine");
  for (let i = 0; i < 4; i++) T.recordRewrite(d, "npm test " + i, 3000 + i); assert.equal(T.isDisabled(d), true, "5 retries in 14 (>30%) switches trim off");
  assert.match(T.report(d), /measured.*bytes removed/s); assert.match(T.report(d), /status\s+OFF/); T.setEnabled(d, true); assert.equal(T.isDisabled(d), false);
  T.recordRewrite(d, "pytest", 9e9); assert.equal(T.recordRewrite(d, "pytest", 9e9 + 4 * 60e3).retry, false, "a re-run after 3 minutes is not a retry");
});
await t("budgets: opt-in writes only its own keys, never overrides yours, off removes only what it wrote", async () => {
  const B = await import(pathToFileURL(path.join(root, "scripts/budgets.mjs")).href); const s = { env: { KEEP: "1" } }, ap = {};
  assert.equal(B.apply(s, true, ap), true); assert.equal(s.env.SLASH_COMMAND_TOOL_CHAR_BUDGET, "4000"); assert.equal(s.env.KEEP, "1");
  assert.equal(B.apply(s, false, ap), true); assert.ok(!("SLASH_COMMAND_TOOL_CHAR_BUDGET" in s.env)); assert.equal(s.env.KEEP, "1");
  const mine = { env: { SLASH_COMMAND_TOOL_CHAR_BUDGET: "12000" } }, ap2 = {}; B.apply(mine, true, ap2); assert.equal(mine.env.SLASH_COMMAND_TOOL_CHAR_BUDGET, "12000", "your own value wins"); B.apply(mine, false, ap2); assert.equal(mine.env.SLASH_COMMAND_TOOL_CHAR_BUDGET, "12000");
});
await t("cascade guidance is in the routing skill and the Codex block stays small", () => {
  assert.match(fs.readFileSync(path.join(root, "skills/routing/SKILL.md"), "utf8"), /Cheap first, verify, then escalate/); assert.ok(fs.statSync(path.join(root, "codex/AGENTS.usage-max.md")).size < 1536);
});
await t("cross-agent gate: counts Codex calls, asks when Codex is RED or on the 3rd call in an hour, ignores everything else", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cg-")); const c = "codex exec --json -o out.md \"review\"";
  assert.equal(G.crossCheck(d, "s", "ls -la", "red"), null); for (const x of ["echo codex exec", "grep -r \"codex exec\" docs", "cat codex-notes.md"]) assert.equal(G.crossCheck(d, "q", x, "red"), null, x); for (const x of ["cd x && codex exec -m y", "FOO=1 codex review", "npx -y codex exec", "/usr/bin/codex exec"]) assert.ok(G.CODEX_CALL.test(x), x);
  assert.match(G.crossCheck(d, "r", c, "red"), /RED/); assert.equal(G.crossCheck(d, "s", c, "green", { now: 1e9 }), null); assert.equal(G.crossCheck(d, "s", "codex exec resume abc", "green", { now: 1e9 + 1 }), null);
  assert.match(G.crossCheck(d, "s", "codex exec resume abc", "green", { now: 1e9 + 2 }), /call #3/); assert.equal(G.crossCheck(d, "s", c, "green", { now: 1e9 + 4e6 }), null, "an hour later the count restarts");
  assert.ok(G.loadEvents(d).counts.codexCalls >= 4);
});
await t("script-first: the same edit in 4 files is flagged once; different edits are not", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sf-")); const e = (f, o = "foo()", n = "bar()") => G.editPattern(d, "s", "Edit", { file_path: f, old_string: o, new_string: n });
  assert.equal(e("a"), null); assert.equal(e("b"), null); assert.equal(e("c"), null); assert.match(e("d"), /ONE small script/); assert.equal(e("e"), null, "only once");
  assert.equal(e("a", "x1", "y1"), null); assert.equal(e("b", "x2", "y2"), null); assert.equal(G.editPattern(d, "s", "Read", {}), null);
});
await t("session cap: off by default, warns at 80% and 100% once each, sums the transcript without double counting", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cap-")); assert.equal(G.loadCap(d), null); assert.equal(G.capCheck(d, "s", 5, null), null);
  const tf = path.join(d, "t.jsonl"); const rec = JSON.stringify({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 0, output_tokens: 100000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }) + "\n"; fs.writeFileSync(tf, rec + rec);
  const cost = G.sessionCost(tf); assert.ok(cost > 1.9 && cost < 2.1, "100k output on Opus 5.5 = $2, counted once: " + cost);
  assert.equal(G.capCheck(d, "s", 1, 5), null); assert.match(G.capCheck(d, "s", 4.2, 5), /80%/); assert.equal(G.capCheck(d, "s", 4.4, 5), null); assert.match(G.capCheck(d, "s", 5.5, 5), /over your \$5 session cap/); assert.equal(G.capCheck(d, "s", 9, 5), null);
});
await t("codex diagnose: attributes the weekly % that moved to the session that moved it, ignores resets, flags the big one", async () => {
  const D = await import(pathToFileURL(path.join(root, "codex/scripts/codex-diagnose.mjs")).href); const ch = fs.mkdtempSync(path.join(os.tmpdir(), "cx-")); const sd = path.join(ch, "sessions", "2026", "10", "10"); fs.mkdirSync(sd, { recursive: true });
  const now = Date.now(); const ev = (i, wk, inp, out) => JSON.stringify({ timestamp: new Date(now - 6e5 + i * 1000).toISOString(), type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: inp, cached_input_tokens: inp - 1000, output_tokens: out, reasoning_output_tokens: 0 } }, rate_limits: { primary: { used_percent: wk }, secondary: { used_percent: wk } } } });
  const meta = (eff) => JSON.stringify({ timestamp: new Date(now - 7e5).toISOString(), type: "session_meta", payload: { cwd: "/p/big", source: "exec", model: "gpt-x" } }) + "\n" + JSON.stringify({ type: "turn_context", payload: { model: "gpt-x", effort: eff } }) + "\n";
  fs.writeFileSync(path.join(sd, "rollout-a.jsonl"), meta("xhigh") + [ev(0, 50, 90000, 500), ev(2, 60, 90000, 500), ev(4, 70, 90000, 500)].join("\n") + "\n");
  fs.writeFileSync(path.join(sd, "rollout-b.jsonl"), meta("low") + [ev(1, 51, 5000, 100), ev(3, 61, 5000, 100), ev(5, 10, 5000, 100)].join("\n") + "\n");
  const r = D.diagnose({ days: 1, home: ch, now: now + 1e6 }); assert.equal(r.R.events, 6); assert.ok(r.R.wkTotal > 19.9 && r.R.wkTotal < 20.1, "reset (70 -> 10) is not counted as usage: " + r.R.wkTotal);
  assert.match(r.text, /by session/); assert.ok(r.findings.some((f) => /xhigh|high\/xhigh/.test(f)) || r.findings.some((f) => /context per call/.test(f)), r.findings.join("|")); assert.ok(r.findings.some((f) => /non-interactive/.test(f)));
  assert.match(D.diagnose({ days: 1, home: path.join(ch, "nope") }).text, /no Codex token events/);
});
await t("local offload: loopback only, refuses secrets and oversize, runs a job against a stub Ollama, counts it", async () => {
  const O = await import(pathToFileURL(path.join(root, "scripts/offload.mjs")).href); const http = await import("node:http");
  assert.equal(O.isLoopback("http://127.0.0.1:11434"), true); assert.equal(O.isLoopback("http://localhost:1"), true); assert.equal(O.isLoopback("http://example.com"), false); assert.equal(O.isLoopback("http://127.0.0.1.evil.com"), false);
  assert.match(O.secretReason(".env", ""), /secrets file/); assert.match(O.secretReason("a.txt", "x -----BEGIN RSA PRIVATE KEY-----"), /key or token/); assert.equal(O.secretReason("a.js", "const a = 1"), null);
  assert.match(O.buildPrompt("commit", "diff"), /BEGIN INPUT/); assert.equal(O.buildPrompt("nope", "x"), null); assert.match(O.buildPrompt("convert:yaml", "x"), /Convert the text below to yaml/);
  const bodies = []; const srv = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { res.setHeader("content-type", "application/json"); if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "llama3:8b" }, { name: "qwen2.5-coder:7b" }] })); bodies.push(JSON.parse(b)); res.end(JSON.stringify({ response: " - did a thing " })); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const host = "http://127.0.0.1:" + srv.address().port;
  try {
    const st = await O.status(host); assert.equal(st.ready, true); assert.equal(O.pickModel(st.models, null), "llama3:8b"); assert.equal(O.pickModel(st.models, "qwen2.5-coder:7b"), "qwen2.5-coder:7b");
    const ok = await O.run("summarize", "hello world", { host, name: "a.txt" }); assert.equal(ok.ok, true); assert.equal(ok.out, "- did a thing"); assert.match(bodies[0].prompt, /hello world/); assert.equal(bodies[0].stream, false);
    assert.match((await O.run("summarize", "x".repeat(O.MAX_IN + 1), { host })).error, /at most/); assert.match((await O.run("summarize", "k", { host, name: ".env" })).error, /refused/); assert.match((await O.run("zzz", "k", { host })).error, /unknown job/);
    assert.equal(bodies.length, 1, "refused and oversize jobs never reach the model");
  } finally { srv.close(); }
  assert.equal((await O.status("http://example.com")).ready, false); assert.match((await O.status("http://127.0.0.1:1")).why, /no local model server/);
});
await t("codex guards: 3rd identical command gets a note and keeps its exit code; big cat is capped (really run in sh); win32/off do nothing", async () => {
  const CG = await import(pathToFileURL(path.join(root, "codex/scripts/codex-guards.mjs")).href); const { spawnSync } = await import("node:child_process");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cgd-")); const big = path.join(d, "big file.txt"), big2 = path.join(d, "big.txt"); fs.writeFileSync(big2, Array.from({ length: 8000 }, (_, i) => "line " + i).join("\n"));
  assert.equal(CG.guard(d, "s", "make test-all", d, "linux"), null); assert.equal(CG.guard(d, "s", "make test-all", d, "linux"), null);
  const c3 = CG.guard(d, "s", "make test-all", d, "linux"); assert.match(c3, /rc=\$\?/); assert.match(c3, /run 3 times in a row/);
  const r = spawnSync("sh", ["-c", c3.replace("make test-all", "sh -c 'echo hi; exit 7'")], { encoding: "utf8" }); assert.equal(r.status, 7, "original exit code kept"); assert.match(r.stdout, /hi/); assert.match(r.stdout, /run 3 times/);
  assert.equal(CG.guard(d, "s", "make other-thing", d, "linux"), null, "a different command resets the streak");
  const bc = CG.guard(d, "s2", "cat big.txt", d, "linux"); assert.ok(bc.startsWith("sed -n '1,200p'")); const o = spawnSync("sh", ["-c", bc], { encoding: "utf8" }); assert.equal(o.stdout.split("\n").filter((x) => x.startsWith("line ")).length, 200); assert.match(o.stdout, /only the first 200 lines are shown/);
  fs.writeFileSync(path.join(d, "small.txt"), "hi"); assert.equal(CG.guard(d, "s2", "cat small.txt", d, "linux"), null); assert.equal(CG.guard(d, "s2", "cat big.txt | head", d, "linux"), null); assert.equal(CG.guard(d, "s2", "cat big.txt", d, "win32"), null);
  assert.equal(CG.guard(d, "s2", "cat big.txt", d, "linux", { USAGE_MAX_GUARDS: "off" }), null); assert.ok(CG.stats(d).bigCats >= 1);
});
await t("codex trim check: re-runs within 3 minutes switch trim off after 10 samples; re-enable resets", async () => {
  const TC = await import(pathToFileURL(path.join(root, "codex/scripts/trimcheck.mjs")).href); const d = fs.mkdtempSync(path.join(os.tmpdir(), "tcc-"));
  for (let i = 0; i < 6; i++) TC.record(d, "npm test " + i, 1000 + i); for (let i = 0; i < 4; i++) TC.record(d, "npm test " + i, 2000 + i); assert.equal(TC.isDisabled(d), true, "4 of 10 re-run");
  TC.setEnabled(d, true); assert.equal(TC.isDisabled(d), false); assert.equal(TC.summary(d), null);
});
await t("auto handoff: builds a resume file from a transcript with no model call (requests, edited files, open todos), skips system noise", async () => {
  const H = await import(pathToFileURL(path.join(root, "scripts/autohandoff.mjs")).href); const d = fs.mkdtempSync(path.join(os.tmpdir(), "ah-")); const tf = path.join(d, "t.jsonl");
  const u = (c) => JSON.stringify({ type: "user", cwd: d, gitBranch: "feat", message: { content: c } }) + "\n"; const a = (b) => JSON.stringify({ type: "assistant", message: { content: b } }) + "\n";
  fs.writeFileSync(tf, u("fix the login bug") + u("<system-reminder>ignore me</system-reminder>") + a([{ type: "tool_use", name: "Edit", input: { file_path: "/x/auth.js" } }, { type: "tool_use", name: "Edit", input: { file_path: "/x/auth.js" } }, { type: "tool_use", name: "TodoWrite", input: { todos: [{ content: "add test", status: "pending" }, { content: "done thing", status: "completed" }] } }]) + u("now add a test"));
  const f = H.write(d, "abcdef123456", tf, { now: new Date("2026-10-10T10:00:00Z") }); assert.ok(fs.existsSync(f)); const md = fs.readFileSync(f, "utf8");
  assert.match(md, /1\. fix the login bug/); assert.match(md, /2\. now add a test/); assert.ok(!/ignore me/.test(md)); assert.match(md, /auth\.js \(2 edits\)/); assert.match(md, /\[ \] add test/); assert.ok(!/done thing/.test(md)); assert.match(md, /Branch: feat/);
  assert.equal(H.write(d, "x", path.join(d, "missing.jsonl")), null);
});
await t("codex weights: learned only with real plan movement; relative to the cheapest model", async () => {
  const W = await import(pathToFileURL(path.join(root, "codex/scripts/codex-weights.mjs")).href); const ev = []; let wk = 0, t = 0;
  for (let i = 0; i < 40; i++) { wk += 0.5; ev.push({ t: t++, model: "cheap", wk, input: 10000, cached: 9000, output: 200 }); }
  for (let i = 0; i < 25; i++) { wk += 2; ev.push({ t: t++, model: "pricey", wk, input: 10000, cached: 9000, output: 200 }); }
  const r = W.learn(ev); assert.equal(r.rows.length, 2); assert.equal(r.rows.find((x) => x.model === "cheap").weight, 1); assert.ok(r.rows.find((x) => x.model === "pricey").weight >= 3);
  assert.equal(W.learn(ev.slice(0, 5)).rows.length, 0); assert.match(W.format(W.learn([])), /not enough/);
});
console.log(`${n} passing`);
