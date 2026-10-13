// Tests for the small-fixes batch (one block per finding id). `node test/fix-w.mjs BUG-038` runs just that block.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv[2] || null; let n = 0;
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const tmp = (p = "umw-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const t = async (id, name, f) => { if (only && only !== id) return; await f(); n++; console.log("ok -", id, name); };
const sandbox = () => { const home = tmp(); process.env.USAGE_MAX_HOME = home; process.env.CODEX_HOME = path.join(home, ".codex"); return home; };
const run = (script, args, home, extra = {}) => spawnSync("node", [path.join(root, script), ...args], { encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: path.join(home, ".codex"), ...extra } });

await t("BUG-038", "balance advice is withheld when the other side's week % is unknown", async () => {
  sandbox();
  const S = await imp("scripts/shared.mjs"), C = await imp("codex/scripts/shared.mjs");
  const now = Date.now(), upd = new Date(now - 60000).toISOString();
  const self = { mode: "red" };
  for (const bad of [null, undefined, NaN, "x"]) {
    const other = { mode: "green", estPct: bad, updatedAt: upd };
    assert.equal(S.balanceAdvice(self, other, now), null, "claude copy, estPct=" + bad);
    assert.equal(C.balanceAdvice(self, other, now), null, "codex copy, estPct=" + bad);
  }
  const ok = { mode: "green", estPct: 12.4, updatedAt: upd };
  assert.match(S.balanceAdvice(self, ok, now), /week ~12% used/);
  assert.match(C.balanceAdvice(self, ok, now), /week ~12% used/);
  assert.match(S.balanceAdvice(self, { ...ok, estPct: 0 }, now), /week ~0% used/, "a real 0 is still advice");
});

await t("BUG-039", "usage-check uses the weekly reset saved with calibrate (Friday reset), not Sunday 07:00", async () => {
  const home = sandbox();
  const reset = new Date(); reset.setHours(18, 0, 0, 0); reset.setDate(reset.getDate() + ((5 - reset.getDay() + 7) % 7)); if (reset.getTime() <= Date.now() + 3600e3) reset.setDate(reset.getDate() + 7);
  const resetsAt = Math.floor(reset.getTime() / 1000), start = resetsAt * 1000 - 7 * 86400e3;
  fs.mkdirSync(path.join(home, ".claude", "usage-max"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "usage-max", "governor.json"), JSON.stringify({ calib: { pct: 10, at: Date.now(), cumAt: 0, resetsAt, source: "manual" }, k: 1 }));
  const proj = path.join(home, ".claude", "projects", "p"); fs.mkdirSync(proj, { recursive: true });
  const rec = { type: "assistant", timestamp: new Date(start + 30000).toISOString(), message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 1000000, output_tokens: 0 } } };
  fs.writeFileSync(path.join(proj, "s.jsonl"), JSON.stringify(rec) + "\n");
  const r = run("scripts/usage-check.mjs", ["--json"], home); const j = JSON.parse(r.stdout);
  assert.match(j.weeklyResetSource, /calibrat/i); assert.ok(Math.abs(j.weekly.cost - 4) < 1e-6, "spend $4, got " + j.weekly.cost);
  assert.equal(new Date(j.weeklyResetLocal).getTime(), start, "week starts 7 days before the saved reset");
  const r2 = run("scripts/usage-check.mjs", ["--json", "--reset", "sun 07:00"], home); assert.equal(JSON.parse(r2.stdout).weeklyResetSource, "arg", "an explicit --reset still wins");
  fs.writeFileSync(path.join(home, ".claude", "usage-max", "governor.json"), JSON.stringify({ calib: { resetsAt: Math.floor(Date.now() / 1000) - 20 * 86400 } }));
  assert.equal(JSON.parse(run("scripts/usage-check.mjs", ["--json"], home).stdout).weeklyResetSource, "default", "a long-expired calibration is ignored");
});

await t("BUG-042", "a message that carries only per-step iterations is priced, equal to the sum of its steps", async () => {
  sandbox();
  const P = await imp("scripts/pricing.mjs"), L = await imp("scripts/lib.mjs");
  const step = (i, o, r, w) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: r, cache_creation_input_tokens: w });
  const steps = [step(1000, 500, 20000, 3000), step(10, 2000, 30000, 0), { ...step(0, 100, 0, 4000), cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 3000 } }];
  for (const model of ["claude-opus-5-5", "claude-haiku-5-5"]) {
    const only = P.recordCost({ model, usage: { iterations: steps } });
    const sum = steps.reduce((a, u) => a + P.recordCost({ model, usage: u }), 0);
    assert.ok(only > 0, model + " must not be free, got " + only); assert.ok(Math.abs(only - sum) < 1e-12, `${model}: ${only} vs ${sum}`);
  }
  const u = L.normalizeUsage({ iterations: steps }); assert.equal(u.output, 2600, "normalizeUsage counts the same steps");
  const top = { input_tokens: 5, output_tokens: 7, iterations: steps };
  assert.equal(P.recordCost({ model: "claude-opus-5-5", usage: top }), P.recordCost({ model: "claude-opus-5-5", usage: { input_tokens: 5, output_tokens: 7 } }), "top-level fields still win when present");
});

await t("BUG-043", "an old status.json is not shown as current; the governor estimate is", async () => {
  const home = sandbox(); const dd = path.join(home, ".claude", "usage-max"); fs.mkdirSync(dd, { recursive: true });
  const sp = path.join(dd, "status.json"); fs.writeFileSync(sp, JSON.stringify({ contextPerDay: 5000000, opusTurns: 77 }));
  fs.writeFileSync(path.join(dd, "governor.json"), JSON.stringify({ mode: "green", last: { at: new Date().toISOString(), estPct: 42 } }));
  const line = () => run("scripts/statusline.mjs", [], home, { USAGE_MAX_MODEL: "claude-opus-5-5" }).stdout.trim();
  const age = (h) => { const d = new Date(Date.now() - h * 3600e3); fs.utimesSync(sp, d, d); };
  age(0.5); assert.equal(line(), "usage-max claude-opus-5-5 \u00b7 budget GREEN \u00b7 5.0M/day \u00b7 opus 77", "fresh file: output unchanged");
  age(5); assert.match(line(), /5\.0M\/day · opus 77 \(as of 5h ago\)/, "shown with its age past 2h");
  age(40 * 24); const old = line(); assert.ok(!/opus 77|\/day/.test(old), "40-day-old summary hidden: " + old); assert.match(old, /wk ~42% \(est\.\)/);
});

await t("SEC-005", "the Opus 5.5 ceiling reads the version wherever it sits in the model id", async () => {
  sandbox();
  const L = await imp("scripts/lib.mjs"), C = await imp("scripts/ceiling.mjs");
  const table = {
    "claude-opus-5-5": "ok", "claude-opus-5": "ok", "claude-opus-4-8": "ok", "claude-opus-5-5-20260101": "ok", "claude-opus-4-20250514": "ok", "claude-opus-4-1-20250805": "ok",
    "claude-sonnet-5-5": "ok", "claude-sonnet-5-5-20260101": "ok", "claude-haiku-5-5": "ok", "claude-haiku-4-5-20251001": "ok", "claude-3-5-sonnet-20241022": "ok", "<synthetic>": "ok",
    "claude-opus-5-6": "above", "claude-opus-6": "above", "claude-fable-5": "above",
    "claude-opus-6[1m]": "above", "claude-opus-6-latest": "above", "us.anthropic.claude-opus-6-v1:0": "above", "claude-opus-6@20260101": "above", "global.anthropic.claude-opus-6-20260101-v1:0": "above", "claude-opus-5-6[1m]": "above",
    "claude-opus-5-5[1m]": "ok", "claude-opus-5-5-latest": "ok", "anthropic.claude-opus-5-5-v1:0": "ok", "claude-opus-5-5@20260101": "ok", "claude-sonnet-5-5[1m]": "ok", "claude-haiku-4-5@20251001": "ok",
    "opus": "unknown", "claude-opus-next": "unknown", "claude-opus-latest": "unknown", "claude-sonnet-latest": "unknown", "claude-haiku-x": "unknown", "some-new-model": "unknown"
  };
  for (const [id, want] of Object.entries(table)) {
    assert.equal(L.ceilingStatus(id), want, "ceilingStatus " + id);
    if (want !== "unknown") assert.equal(C.aboveCeiling(id), want === "above", "aboveCeiling " + id);
  }
  for (const id of ["opus", "claude-opus-next"]) assert.equal(C.aboveCeiling(id), false, "an alias is not blocked: " + id);
});

await t("BUG-041", "usage-check and audit survive one message straddling the window start", async () => {
  const home = sandbox(); const proj = path.join(home, ".claude", "projects", "p"); fs.mkdirSync(proj, { recursive: true });
  const now = Date.now(), start = now - 7 * 86400e3; // audit's last-7-days window; usage-check gets the same start through a limits file
  const usage = { input_tokens: 1000, output_tokens: 100 };
  const rec = (ts, content) => JSON.stringify({ type: "assistant", timestamp: new Date(ts).toISOString(), message: { id: "straddle", model: "claude-opus-5-5", usage, content } }) + "\n";
  fs.writeFileSync(path.join(proj, "s.jsonl"), rec(start - 120e3, [{ type: "text", text: "hi" }]) + rec(start + 120e3, [{ type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "/x" } }]));
  const lim = path.join(home, "limits.json"); fs.writeFileSync(lim, JSON.stringify({ capturedAt: new Date().toISOString(), seven_day: { used_percentage: 10, resets_at: Math.floor((now + 3600e3) / 1000) } }));
  // usage-check's window starts at resets_at - 7d (= 7d minus 1h ago): a second straddling pair sits around that start
  const ucStart = Math.floor((now + 3600e3) / 1000) * 1000 - 7 * 86400e3;
  fs.writeFileSync(path.join(proj, "u.jsonl"), rec(ucStart - 120e3, [{ type: "text", text: "hi" }]).replace("straddle", "straddle2") + rec(ucStart + 120e3, [{ type: "tool_use", id: "tu2", name: "Edit", input: { file_path: "/y" } }]).replace("straddle", "straddle2"));
  const uc = run("scripts/usage-check.mjs", ["--json", "--limits", lim], home); assert.ok(uc.status === 0 || uc.status === 2, "usage-check crashed: " + uc.stderr.split("\n").slice(0, 6).join(" | "));
  assert.ok(JSON.parse(uc.stdout).weekly, "usage-check printed a report");
  const au = run("scripts/audit.mjs", ["--json"], home); assert.equal(au.status, 0, "audit crashed: " + au.stderr.split("\n").slice(0, 6).join(" | "));
});

await t("BUG-040", "a message repeated across transcript files counts once everywhere, at its largest output", async () => {
  const home = sandbox(); const dir = path.join(home, ".claude", "projects"); const proj = path.join(dir, "p"); fs.mkdirSync(path.join(proj, "sess", "subagents"), { recursive: true });
  const now = Date.now(), at = (s) => new Date(now - s * 1000).toISOString();
  const rec = (id, out, s, extra = {}) => JSON.stringify({ type: "assistant", timestamp: at(s), message: { id, model: "claude-opus-5-5", usage: { input_tokens: 1000000, output_tokens: out }, ...extra } }) + "\n";
  const main = path.join(proj, "main.jsonl"), sub = path.join(proj, "sess", "subagents", "agent-1.jsonl");
  const lim = path.join(home, "limits.json"); fs.writeFileSync(lim, JSON.stringify({ capturedAt: new Date().toISOString(), seven_day: { used_percentage: 10, resets_at: Math.floor(now / 1000) + 3 * 86400 } }));
  const usd = (out) => 4 + out * 20 / 1e6; // 1M input at $4/M plus output at $20/M
  const check = async (label, turns, cost) => {
    const uc = JSON.parse(run("scripts/usage-check.mjs", ["--json", "--limits", lim], home).stdout);
    assert.equal(uc.weekly.assistantTurns, turns, label + ": usage-check turns"); assert.ok(Math.abs(uc.weekly.cost - cost) < 1e-9, `${label}: usage-check cost ${uc.weekly.cost} vs ${cost}`);
    const au = JSON.parse(run("scripts/audit.mjs", ["--json"], home).stdout); assert.equal(au.allTime.assistantTurns, turns, label + ": audit turns");
    const dg = JSON.parse(run("scripts/diagnose.mjs", ["--json"], home).stdout); assert.equal(dg.turns, turns, label + ": diagnose turns"); assert.ok(Math.abs(dg.listPriceCost - cost) < 1e-9, `${label}: diagnose cost ${dg.listPriceCost} vs ${cost}`);
    const svr = await (await imp("scripts/savings.mjs")).claudeSavings({ dir, days: 7, now: now + 1000 }); assert.equal(svr.turns, turns, label + ": savings turns"); assert.ok(Math.abs(svr.total - cost) < 1e-9, `${label}: savings cost ${svr.total} vs ${cost}`);
    const ev = await (await imp("scripts/anomaly.mjs")).claudeEvents(dir, 7, now + 1000); assert.equal(ev.length, turns, label + ": anomaly events");
  };
  // 1. the sub-agent transcript copies a parent message verbatim
  fs.writeFileSync(main, rec("A", 10000, 60)); fs.writeFileSync(sub, rec("A", 10000, 60)); await check("copy in a sub-agent file", 1, usd(10000));
  // 2. the later copy has more output (streaming update): it wins, whichever file it is in
  fs.writeFileSync(sub, rec("A", 50000, 59)); await check("later copy larger", 1, usd(50000));
  fs.writeFileSync(main, rec("A", 50000, 59)); fs.writeFileSync(sub, rec("A", 10000, 60)); await check("earlier copy larger", 1, usd(50000));
  // 3. within one file the first record is a partial count, a later record of the same message is the final one
  fs.writeFileSync(main, rec("B", 10, 60) + rec("B", 5000, 59)); fs.rmSync(sub); await check("streaming update in one file", 1, usd(5000));
  // 4. distinct messages are untouched
  fs.writeFileSync(main, rec("C", 100, 60) + rec("D", 200, 59)); fs.writeFileSync(sub, rec("E", 300, 58)); await check("distinct ids", 3, usd(100) + usd(200) + usd(300));
  // ttl advice: a resumed session file that repeats every turn of the original is not a second session
  fs.writeFileSync(main, rec("T1", 100, 300) + rec("T2", 100, 200) + rec("T3", 100, 100)); fs.writeFileSync(path.join(proj, "resumed.jsonl"), rec("T1", 100, 300) + rec("T2", 100, 200) + rec("T3", 100, 100)); fs.rmSync(sub, { force: true });
  const T = await imp("scripts/ttl.mjs"); const adv = await T.ttlAdvice(dir, { minSessions: 1, nowMs: now + 1000 }); assert.equal(adv.sessions, 1, "ttl: one session, not two");
});

console.log(`${n} passing`);
