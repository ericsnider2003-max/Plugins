import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "umg-")); process.env.USAGE_MAX_HOME = home;
const dir = path.join(home, ".claude", "usage-max"); fs.mkdirSync(dir, { recursive: true });
const G = await import(pathToFileURL(path.join(root, "scripts/guard.mjs")).href);
const { scan, archive } = await import(pathToFileURL(path.join(root, "scripts/ctxfiles.mjs")).href);
let n = 0; const t = (name, f) => { f(); n++; console.log("ok -", name); };
const tr = path.join(home, "t.jsonl"); const ctxLine = (c) => JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: c } } }) + "\n";
t("lastContext reads the newest usage", () => { fs.writeFileSync(tr, ctxLine(1000) + ctxLine(90000)); assert.equal(G.lastContext(tr), 90010); assert.equal(G.lastContext("/nope"), null); });
t("cold cache warns only for a big context after the TTL", () => {
  G.promptCheck(dir, "s1", { now: 1e9, ctx: 90000 });
  assert.equal(G.promptCheck(dir, "s1", { now: 1e9 + 60e3, ctx: 90000 }), null, "warm");
  assert.match(G.promptCheck(dir, "s1", { now: 1e9 + 60e3 + 400e3, ctx: 90000 }), /idle 7 min.*handoff/s);
  G.promptCheck(dir, "s2", { now: 1e9, ctx: 5000 }); assert.equal(G.promptCheck(dir, "s2", { now: 1e9 + 9e6, ctx: 5000 }), null, "small context: nothing to save");
  G.promptCheck(dir, "s3", { now: 1e9, ctx: 90000 }); assert.equal(G.promptCheck(dir, "s3", { now: 1e9 + 9e6, ctx: 90000, ttlMs: 3600e3 * 5 }), null, "within a long TTL");
});
t("big-context compact nudge fires once per +40k", () => {
  assert.match(G.promptCheck(dir, "c1", { now: 1, ctx: 160000 }), /compact/); assert.equal(G.promptCheck(dir, "c1", { now: 2, ctx: 170000 }), null);
  assert.match(G.promptCheck(dir, "c1", { now: 3, ctx: 205000 }), /compact/); assert.equal(G.promptCheck(dir, "c1", { now: 4, ctx: 40000 }), null);
  assert.match(G.promptCheck(dir, "c1", { now: 5, ctx: 160000 }), /compact/, "after compaction it can nudge again");
});
t("loop: 3rd identical call warns, 6th escalates, an edit resets, different calls do not warn", () => {
  const b = { command: "npm test" }; assert.equal(G.loopCheck(dir, "l1", "Bash", b), null); assert.equal(G.loopCheck(dir, "l1", "Bash", b), null);
  assert.match(G.loopCheck(dir, "l1", "Bash", b).additionalContext, /3 times/); assert.equal(G.loopCheck(dir, "l1", "Bash", b), null);
  G.loopCheck(dir, "l1", "Bash", b); const r = G.loopCheck(dir, "l1", "Bash", b); assert.match(r.additionalContext, /Stop now/); assert.ok(r.systemMessage);
  G.loopCheck(dir, "l2", "Bash", b); G.loopCheck(dir, "l2", "Bash", b); G.loopCheck(dir, "l2", "Edit", { file_path: "a" }); assert.equal(G.loopCheck(dir, "l2", "Bash", b), null, "edit between = progress");
  for (let i = 0; i < 8; i++) assert.equal(G.loopCheck(dir, "l3", "Bash", { command: "echo " + i }), null);
});
t("Read hints: first big read, then unchanged re-read; ranged reads and changed files are quiet; reset forgets", () => {
  const big = path.join(home, "big.txt"), small = path.join(home, "small.txt"); fs.writeFileSync(big, "x".repeat(60000)); fs.writeFileSync(small, "hi");
  assert.match(G.readCheck(dir, "r1", { file_path: big }), /60 KB.*Grep/); assert.match(G.readCheck(dir, "r1", { file_path: big }), /already read in full/);
  assert.equal(G.readCheck(dir, "r1", { file_path: big, offset: 5, limit: 20 }), null);
  assert.equal(G.readCheck(dir, "r1", { file_path: small }), null); assert.match(G.readCheck(dir, "r1", { file_path: small }), /already read/);
  fs.writeFileSync(small, "changed content"); assert.equal(G.readCheck(dir, "r1", { file_path: small }), null, "file changed: read it");
  G.resetReads(dir, "r1"); assert.equal(G.readCheck(dir, "r1", { file_path: small }), null, "after compact/clear it is not in context any more");
  assert.equal(G.readCheck(dir, "r1", { file_path: "/does/not/exist" }), null);
  const part = path.join(home, "part.txt"); fs.writeFileSync(part, "y".repeat(500)); G.readCheck(dir, "r2", { file_path: part, offset: 1, limit: 3 }); assert.equal(G.readCheck(dir, "r2", { file_path: part }), null, "a ranged read is not a full read");
});
t("subagent cap by mode, release, expiry, config override", () => {
  const f = (m, id, now) => G.agentStart(dir, id, m, false, now); fs.rmSync(path.join(dir, "inflight.json"), { force: true });
  assert.equal(f("red", "a", 1000), null); assert.match(f("red", "b", 1001).deny, /cap 1 in RED/); G.agentEnd(dir, "a"); assert.equal(f("red", "b", 1002), null);
  fs.rmSync(path.join(dir, "inflight.json")); for (const id of "1234") assert.equal(f("green", id, 5000), null); assert.ok(f("green", "5", 5001).deny);
  assert.equal(f("green", "5", 5000 + 21 * 60e3), null, "stale entries expire (a crashed subagent never blocks you forever)");
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ maxSubagents: 8 })); fs.rmSync(path.join(dir, "inflight.json")); for (let i = 0; i < 8; i++) assert.equal(f("red", "x" + i, 9000), null); fs.rmSync(path.join(dir, "config.json"));
});
t("digest counts and queue", () => {
  assert.ok(G.digest(dir).lines.length > 0); G.queueOp(dir, "add", "tidy docs"); G.queueOp(dir, "add", "rename x"); assert.equal(G.queueOp(dir, "next").taken.text, "tidy docs"); assert.equal(G.loadQueue(dir).length, 1); assert.ok(G.queueOp(dir, "add", "").error); G.queueOp(dir, "clear"); assert.equal(G.loadQueue(dir).length, 0);
});
t("ctxfiles: follows @imports, flags big and stale, archive is reversible and never deletes", () => {
  const p = path.join(home, "proj"); fs.mkdirSync(path.join(p, "docs"), { recursive: true });
  fs.writeFileSync(path.join(p, "CLAUDE.md"), "rules\n@docs/old.md\n@docs/huge.md\n"); fs.writeFileSync(path.join(p, "docs/old.md"), "o".repeat(2000)); fs.writeFileSync(path.join(p, "docs/huge.md"), "h".repeat(20000));
  const old = new Date(Date.now() - 200 * 864e5); fs.utimesSync(path.join(p, "docs/old.md"), old, old);
  const r = scan({ home, cwd: p }); assert.equal(r.rows.filter((x) => x.file.startsWith(p)).length, 3);
  assert.ok(r.advice.some((a) => /old\.md/.test(a.file) && /untouched/.test(a.why))); assert.ok(r.advice.some((a) => /huge\.md/.test(a.file) && /every turn/.test(a.why)));
  const a = archive(path.join(p, "docs/old.md")); assert.ok(fs.existsSync(a.to) && !fs.existsSync(path.join(p, "docs/old.md"))); assert.ok(archive(path.join(p, "nope.md")).error);
});
t("hook entry: silent + exit 0 on garbage, silent under Codex, Read hint through the real hook", () => {
  const run = (input, env = {}) => spawnSync("node", [path.join(root, "hooks/guard.mjs")], { input, encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, ...env } });
  let r = run("not json"); assert.equal(r.status, 0); assert.equal(r.stdout, "");
  const big = path.join(home, "hook-big.txt"); fs.writeFileSync(big, "z".repeat(50000));
  r = run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", session_id: "h1", tool_input: { file_path: big } }), { USAGE_MAX_HOST: "claude" }); assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout); assert.equal(o.hookSpecificOutput.hookEventName, "PreToolUse"); assert.ok(!("permissionDecision" in o.hookSpecificOutput), "a hint never decides permissions"); assert.match(o.hookSpecificOutput.additionalContext, /50 KB/);
  r = run(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", session_id: "h2", turn_id: "x", tool_input: { file_path: big } })); assert.equal(r.stdout, "", "Codex payload: do nothing");
});
const GV = await import(pathToFileURL(path.join(root, "scripts/governor.mjs")).href);
const BG = await import(pathToFileURL(path.join(root, "scripts/background.mjs")).href);
t("lean mode: RED caps compaction and thinking, keeps going back to the user's values in GREEN", () => {
  const ap = {}; const s = { model: "x" };
  assert.equal(GV.patchLean(s, "red", ap), true); assert.equal(s.autoCompactWindow, 120000); assert.equal(s.alwaysThinkingEnabled, false);
  assert.equal(GV.patchLean(s, "amber", ap), true); assert.equal(s.autoCompactWindow, 160000); assert.ok(!("alwaysThinkingEnabled" in s), "amber lifts the thinking cap");
  assert.equal(GV.patchLean(s, "green", ap), true); assert.ok(!("autoCompactWindow" in s)); assert.equal(s.model, "x");
  const mine = { autoCompactWindow: 300000 }; GV.patchLean(mine, "green", {}); assert.equal(mine.autoCompactWindow, 300000, "a value you set in GREEN is never touched");
  const mine2 = { alwaysThinkingEnabled: true }; GV.patchLean(mine2, "red", {}); assert.equal(mine2.alwaysThinkingEnabled, false, "RED may tighten your value");
  GV.patchLean(mine2, "green", {}); assert.equal(mine2.alwaysThinkingEnabled, false, "...and green does not delete what it did not own");
});
t("time to empty only from real data and only when it beats the reset", () => {
  assert.equal(GV.timeToEmpty({ estPct: 67, ratePerHour: 2, hoursLeft: 36, rateSource: "plan %" }).hours, 16.5);
  assert.equal(GV.timeToEmpty({ estPct: 67, ratePerHour: 0.5, hoursLeft: 36, rateSource: "plan %" }), null, "lasts to reset");
  assert.equal(GV.timeToEmpty({ estPct: 67, ratePerHour: 2, hoursLeft: 36, rateSource: "none yet" }), null);
  assert.equal(GV.timeToEmpty({ estPct: null, ratePerHour: 2, hoursLeft: 36 }), null);
});
t("background-burn parsers flag scheduled/headless claude+codex only", () => {
  assert.equal(BG.parseCron("# c\n0 * * * * claude -p 'x'\n5 * * * * backup.sh\n").length, 1);
  assert.equal(BG.parseSchtasks('"PC","\\NightlyClaude","N/A"\n"PC","\\Other","x"\n')[0].text, "\\NightlyClaude");
  const ps = "  10 01:00 claude -p do stuff\n  11 02:00 /usr/bin/claude --resume\n  12 00:30 codex exec fix\n  13 00:10 /bin/sh -c ln -sf /opt/claude-code/bin/claude x\n  99 00:01 node usage-max/scripts/background.mjs claude -p";
  assert.deepEqual(BG.parsePs(ps, 1).map((x) => x.text.slice(0, 6)), ["pid 10", "pid 12"]);
});
t("enable-here --lean keeps only the named plugins on and never overwrites", () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "umlean-")), proj = path.join(h, "repo"); fs.mkdirSync(path.join(h, ".claude"), { recursive: true }); fs.mkdirSync(proj);
  fs.writeFileSync(path.join(h, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "a@m": true, "b@m": true, "c@m": true } }));
  const run = () => spawnSync("node", [path.join(root, "scripts/usage-max.mjs"), "enable-here", proj, "--lean", "a"], { env: { ...process.env, USAGE_MAX_HOME: h }, encoding: "utf8" });
  assert.equal(run().status, 0); const e = JSON.parse(fs.readFileSync(path.join(proj, ".claude/settings.json"))).enabledPlugins;
  assert.equal(e["b@m"], false); assert.equal(e["c@m"], false); assert.ok(e["a@m"] !== false); assert.equal(e["usage-max@eric-plugins"], true);
  e["b@m"] = true; fs.writeFileSync(path.join(proj, ".claude/settings.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(proj, ".claude/settings.json"))), enabledPlugins: e })); run();
  assert.equal(JSON.parse(fs.readFileSync(path.join(proj, ".claude/settings.json"))).enabledPlugins["b@m"], true, "an explicit choice in the repo is kept");
});
console.log(`${n} passing`);
