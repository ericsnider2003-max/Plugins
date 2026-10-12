// Tests for the roundtrip audit fixes (one block per finding id). `node test/fix.mjs BUG-014` runs just that block.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv[2] || null; let n = 0;
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const tmp = (p = "umf-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const t = async (id, name, f) => { if (only && only !== id) return; await f(); n++; console.log("ok -", id, name); };

await t("BUG-014", "Codex model survives a scan boundary (split log costs the same as one scan)", async () => {
  const home = tmp(); process.env.USAGE_MAX_HOME = home; process.env.CODEX_HOME = path.join(home, ".codex");
  const G = await imp("codex/scripts/codex-governor.mjs");
  const dir = path.join(process.env.CODEX_HOME, "sessions/2026/10/12"); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, "rollout-a.jsonl");
  const tc = (ts) => JSON.stringify({ timestamp: ts, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000000, cached_input_tokens: 0, output_tokens: 0 } } } }) + "\n";
  const now = Date.now(); const ts = new Date(now - 1000).toISOString();
  const head = JSON.stringify({ type: "turn_context", payload: { model: "sol-1" } }) + "\n" + tc(ts);
  fs.writeFileSync(f, head); G.meterAll(G.loadConfig(), now, true);
  fs.appendFileSync(f, tc(ts)); const m = G.meterAll(G.loadConfig(), now + 1, true);
  const total = Object.values(m.hours).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 40) < 1e-6, "two 1M-input lines at weight 20 = 40, got " + total);
});

await t("BUG-016", "a few minutes into the 5-hour window never forces red", async () => {
  const L = await imp("scripts/lib.mjs"), G = await imp("scripts/governor.mjs");
  const now = Date.now(), win = { used_percentage: 4, resets_at: Math.floor((now + (5 * 3600 - 7 * 60) * 1000) / 1000) };
  const fp = L.pace(win, 5 * 3600, now);
  assert.equal(G.fiveHourFloor(fp), null, "4% after 7 minutes: not enough evidence");
  assert.equal(G.fiveHourFloor({ state: "over", used: 96, elapsed: 0.05, projected: 500 }), "red", "a nearly full window is real at any time");
  assert.equal(G.fiveHourFloor({ state: "over", used: 40, elapsed: 0.15, projected: 200 }), "amber", "10%+ elapsed: amber, not red");
  assert.equal(G.fiveHourFloor({ state: "over", used: 70, elapsed: 0.4, projected: 175 }), "red");
});

await t("BUG-006", "watchers and dev servers are never wrapped by the trimmer", async () => {
  const home = tmp(); const wrapped = (c) => { const r = spawnSync("node", [path.join(root, "hooks/bash-trim.mjs")], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: c } }), encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, USAGE_MAX_HOST: "claude" } }); return /updatedInput/.test(r.stdout); };
  for (const c of ["npm run dev", "npm run test:watch", "npx jest --watch", "npx tsc --watch", "pnpm run build --watch", "npm run test -- --watchAll", "make serve", "yarn test -w", "npm run start"]) assert.equal(wrapped(c), false, c);
  for (const c of ["npm test", "npx tsc", "pytest tests/", "cargo build", "npm run build"]) assert.equal(wrapped(c), true, c + " is still trimmed");
  const CH = await imp("codex/scripts/codex-hook.mjs"); for (const c of ["npm run dev", "npx jest --watch", "npm run test:watch"]) assert.equal(CH.rewrite(c, "/x/run.mjs", "linux"), null, "codex: " + c); assert.ok(CH.rewrite("npm test", "/x/run.mjs", "linux"), "codex still trims npm test");
});

await t("BUG-007", "loop guard ignores polling and file-changing commands, and long commands that differ", async () => {
  const G = await imp("scripts/guard.mjs"), CG = await imp("codex/scripts/codex-guards.mjs"); const dir = tmp();
  for (let i = 0; i < 8; i++) assert.equal(G.loopCheck(dir, "s", "Bash", { command: "gh run view 123 --json status" }), null, "polling is waiting");
  const long = "echo " + "x".repeat(700);
  for (let i = 0; i < 4; i++) assert.equal(G.loopCheck(dir, "s2", "Bash", { command: long + i }), null, "different tails are different calls");
  let w = null; for (let i = 0; i < 3; i++) w = G.loopCheck(dir, "s3", "Bash", { command: "npm test -- foo" }); assert.ok(w && w.additionalContext, "a real repeat still warns");
  const d2 = tmp(); for (let i = 0; i < 6; i++) assert.equal(CG.loopNote(d2, "c", "gh run view 123"), null, "codex polling");
  let n3 = null; for (let i = 0; i < 6; i++) n3 = CG.loopNote(d2, "c2", "npm install left-pad"); assert.equal(n3, null, "a command that changes files is progress, not a loop");
  let n4 = null; for (let i = 0; i < 3; i++) n4 = CG.loopNote(d2, "c3", "npm test -- foo"); assert.ok(n4, "a real repeat still warns");
});

await t("BUG-001", "memory sync never deletes text around odd markers", async () => {
  const home = tmp(); process.env.USAGE_MAX_HOME = home; const M = await imp("scripts/memory.mjs"); const proj = path.join(home, "p"); fs.mkdirSync(proj); const mem = M.init(proj); M.decide(mem, "package manager", "pnpm");
  const f = path.join(proj, "AGENTS.md"), keep = "MY OWN NOTES: never delete me\n";
  const cases = { orphanBegin: M.BEGIN + "\n" + keep + "more user text\n", orphanEnd: keep + M.END + "\n", dup: M.BEGIN + "\n" + keep + M.BEGIN + "\nx\n" + M.END + "\n", fenced: "```\n" + M.BEGIN + "\n```\n" + keep + "\n" + M.END + "\n" };
  for (const [k, text] of Object.entries(cases)) { fs.writeFileSync(f, text); const r = M.syncFile(mem, f); assert.ok(fs.readFileSync(f, "utf8").includes("never delete me"), k + ": user text survives"); assert.ok(r.error || r.changed === false, k); }
  fs.writeFileSync(f, "intro\n" + M.BEGIN + "\nold\n" + M.END + "\noutro\n"); assert.equal(M.syncFile(mem, f).changed, true); const out = fs.readFileSync(f, "utf8"); assert.ok(out.startsWith("intro\n") && out.includes("outro") && !out.includes("\nold\n") && out.includes("pnpm"), "a well-formed block is replaced in place");
  assert.equal(M.syncFile(mem, f).changed, false, "idempotent");
});

await t("SEC-001", "secret filter catches modern key shapes and leaves ordinary sentences alone", async () => {
  const M = await imp("scripts/memory.mjs"), O = await imp("scripts/offload.mjs");
  const bad = ["sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv", "sk-proj-AbCdEfGhIjKlMnOpQrStUvWx", "github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuv", "postgres://admin:s3cretPw@db.internal:5432/app", "whsec_AbCdEfGhIjKlMnOpQrSt", "AIzaSyA-1234567890abcdefghijklmnopqrstuv", "npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "the password is hunter2hunter2", "token: abcdefgh"];
  for (const b of bad) { assert.ok(M.looksSecret(b), "caught: " + b); assert.ok(!M.redact(b).includes(b.split(/[ :]/).pop()) || b.includes("://"), "redacted: " + b); }
  for (const ok of ["the token is refreshed hourly", "password reset flow lives in auth/reset.ts", "we rotate the secret every quarter", "use pnpm, not npm", "see https://example.com/docs for details"]) assert.ok(!M.looksSecret(ok), "not a secret: " + ok);
  assert.ok(O.secretReason("x.txt", "postgres://admin:s3cretPw@db/app"), "offload refuses it too");
});

await t("GAP-001", "CI also runs the node tests on Windows", async () => {
  const y = fs.readFileSync(path.join(root, "..", ".github/workflows/usage-max.yml"), "utf8");
  assert.match(y, /runs-on:\s*windows-latest/); const win = y.slice(y.indexOf("windows-latest"));
  for (const f of ["check.mjs", "test/run.mjs", "test/memory.mjs", "test/guard.mjs", "codex/test/run.mjs"]) assert.ok(win.includes(f), "windows job runs " + f);
});

await t("BUG-015", "spend since a moment counts only the later share of the straddling hour; Codex rate and hysteresis are sane", async () => {
  const home = tmp(); process.env.USAGE_MAX_HOME = home; process.env.CODEX_HOME = path.join(home, ".codex");
  const G = await imp("codex/scripts/codex-governor.mjs"), Mt = await imp("scripts/meter.mjs");
  const h0 = Math.floor(Date.now() / 36e5) - 3, mid = h0 * 36e5 + 18e5;
  assert.ok(Math.abs(G.spendSince({ hours: { [h0]: 10 } }, mid) - 5) < 1e-9, "half the hour is after the half-hour mark");
  assert.ok(Math.abs(Mt.spendInLast({ buckets: { [new Date(h0 * 36e5).toISOString()]: 10 } }, (Date.now() - mid) / 36e5, Date.now()) - 5) < 1e-6, "Claude meter: same rule");
  const cfg = G.DEFAULT_CONFIG;
  assert.equal(G.decide({ estPct: 10, hoursLeft: 100, ratePerHour: 0, prevMode: "amber", cfg }), "green");
  const sustain = (cfg.target - 10) / 100; const justBelowRed = sustain * cfg.redRatio * 0.95;
  assert.equal(G.decide({ estPct: 10, hoursLeft: 100, ratePerHour: justBelowRed, prevMode: "amber", cfg }), "amber", "amber does not jump to red below the red level");
  assert.equal(G.decide({ estPct: 10, hoursLeft: 100, ratePerHour: justBelowRed, prevMode: "red", cfg }), "red", "red is held a little longer");
  const now = Date.now(), resets = now + 6.9 * 864e5; // window began ~2.4 h ago; earlier spend must not count
  const m = { hours: { [Math.floor((now - 5 * 36e5) / 36e5)]: 100, [Math.floor(now / 36e5)]: 1 } };
  const e = G.estimate({ calib: { pct: 1, at: now - 2.4 * 36e5, resets: new Date(resets).toISOString() }, k: 1 }, m, now, { ...cfg, burnWindowHours: 12 });
  assert.ok(e.rate < 5, "rate ignores spend from before the window began: " + e.rate);
  assert.equal(G.fiveFloor({ pct: 4, resetsAt: Math.floor((now + 293 * 6e4) / 1000), windowMinutes: 300 }, now), "green");
});

console.log(`${n} passing`);
