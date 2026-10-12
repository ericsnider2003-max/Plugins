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

console.log(`${n} passing`);
