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

console.log(`${n} passing`);
