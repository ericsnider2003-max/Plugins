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
console.log(`${n} passing`);
