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

console.log(`${n} passing`);
