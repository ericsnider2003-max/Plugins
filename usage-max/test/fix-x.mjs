// Tests for the small-fixes batch X (one block per finding id). `node test/fix-x.mjs BUG-045` runs just that block.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { spawnSync } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const only = process.argv[2] || null; let n = 0;
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const tmp = (p = "umx-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
const t = async (id, name, f) => { if (only && only !== id) return; await f(); n++; console.log("ok -", id, name); };
const sandbox = () => { const home = tmp(); process.env.USAGE_MAX_HOME = home; process.env.CODEX_HOME = path.join(home, ".codex"); return home; };
const run = (script, args, home, extra = {}) => spawnSync("node", [path.join(root, script), ...args], { encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: path.join(home, ".codex"), ...extra } });
const POSIX = process.platform !== "win32";

await t("BUG-045", "the same command in two folders is two cache entries (a PASS in pkg-a is not replayed in pkg-b)", async () => {
  const home = sandbox(); delete process.env.USAGE_MAX_EVAL_CACHE;
  const mk = (name) => { const d = path.join(home, name); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "a.txt"), "same"); return d; };
  const A = mk("pkg-a"), B = mk("pkg-b");
  const go = (cwd) => spawnSync("node", [path.join(root, "scripts/eval-cache.mjs"), "--key", "a.txt", "--", "node", "-e", "console.log('RAN IN ' + require('path').basename(process.cwd()))"], { cwd, encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home } });
  const a1 = go(A); assert.equal(a1.status, 0); assert.match(a1.stdout, /RAN IN pkg-a/);
  const a2 = go(A); assert.match(a2.stderr, /HIT/, "same folder still hits");
  const b1 = go(B); assert.doesNotMatch(b1.stderr, /HIT/, "other folder must not hit"); assert.match(b1.stdout, /RAN IN pkg-b/);
  const E = await imp("scripts/eval-cache.mjs"), cmd = ["x"];
  assert.notEqual(E.keyFor({ keys: [], cmd, cwd: A }), E.keyFor({ keys: [], cmd, cwd: B }));
  assert.equal(E.keyFor({ keys: [], cmd, cwd: A }), E.keyFor({ keys: [], cmd, cwd: path.join(A, ".", "..", "pkg-a") }), "the folder is resolved before hashing");
});

console.log(`${n} passing`);
