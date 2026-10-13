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

await t("BUG-049", "the Codex installer exits non-zero and lists what failed when hooks.json is corrupt", async () => {
  const mk = () => { const home = tmp(); const ch = path.join(home, ".codex"); fs.mkdirSync(ch, { recursive: true }); return { home, ch, env: { ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: ch } }; };
  const inst = (env) => spawnSync("node", [path.join(root, "codex/scripts/install.mjs")], { env, encoding: "utf8" });
  const ok = mk(); const r0 = inst(ok.env); assert.equal(r0.status, 0, "a clean install still succeeds: " + r0.stderr); assert.match(r0.stdout, /^installed\. mode=/m);
  const bad = mk(); const corrupt = "{ this is : not json"; fs.writeFileSync(path.join(bad.ch, "hooks.json"), corrupt);
  const r = inst(bad.env); assert.notEqual(r.status, 0, "corrupt hooks.json must give a failing exit code");
  assert.match(r.stderr, /INSTALL INCOMPLETE/); assert.match(r.stderr, /hooks\.json was not updated/); assert.doesNotMatch(r.stdout, /^installed\. mode=/m, "must not claim a clean install");
  assert.equal(fs.readFileSync(path.join(bad.ch, "hooks.json"), "utf8"), corrupt, "the user's file is left exactly as it was");
  assert.ok(fs.existsSync(path.join(bad.ch, "skills", "usage-max", "SKILL.md")), "the other steps still ran");
});

await t("BUG-051", "only an explicit remember word or colon saves a decision, and personal data is refused", async () => {
  const home = sandbox(), M = await imp("scripts/memory.mjs");
  const proj = path.join(home, "proj"); fs.mkdirSync(proj); const mem = M.init(proj); const dec = path.join(mem, "decisions.md");
  const hook = (prompt) => spawnSync("node", [path.join(root, "hooks/memory.mjs")], { input: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: proj, session_id: "s", prompt }), encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home, USAGE_MAX_HOST: "claude" } });
  const before = fs.readFileSync(dec, "utf8");
  for (const p of ["From now on, please email the report to bob@example.com every Friday", "From now on I would like shorter answers when you explain things", "Going forward we will bill monthly and keep a ledger of it", "From now on please use my address jane.doe@example.org for the invoices"]) {
    assert.equal(M.extractDirective(p), null, "an ordinary request is not a decision: " + p);
    const r = hook(p); assert.doesNotMatch(r.stdout, /saved to project memory/); assert.equal(fs.readFileSync(dec, "utf8"), before, "nothing written for: " + p);
  }
  for (const p of ["remember: use pnpm in this repo please", "From now on: run lint before every commit", "From now on, remember that we ship on Thursdays", "Going forward, always remember to run the type check"]) {
    assert.ok(M.extractDirective(p), "explicit forms still extract: " + p);
  }
  const ok = hook("remember: use pnpm in this repo please"); assert.match(ok.stdout, /saved to project memory/); assert.match(fs.readFileSync(dec, "utf8"), /use pnpm in this repo please/);
  const mid = fs.readFileSync(dec, "utf8");
  for (const p of ["remember: send invoices to bob@example.com", "From now on: the deploy token is ghp_" + "a".repeat(36), "remember: use the key sk-ant-api03-" + "b".repeat(30) + " for the API"]) {
    const r = hook(p); assert.match(r.stdout, /not saved/, "refused with a message: " + p); assert.equal(fs.readFileSync(dec, "utf8"), mid, "personal data never reaches decisions.md: " + p);
  }
});

console.log(`${n} passing`);
