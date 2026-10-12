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

console.log(`${n} passing`);
