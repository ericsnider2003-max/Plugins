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

await t("SEC-007", "cached output is redacted, stored private (0600/0700) and old entries are pruned", async () => {
  const home = sandbox(); delete process.env.USAGE_MAX_EVAL_CACHE; const cache = path.join(home, ".usage-max", "eval-cache");
  const proj = path.join(home, "proj"); fs.mkdirSync(proj); fs.writeFileSync(path.join(proj, "in.txt"), "x");
  const tok = "ghp_" + "Ab1".repeat(12), pw = "hunter2hunter2";
  const go = (extra = []) => spawnSync("node", [path.join(root, "scripts/eval-cache.mjs"), "--key", "in.txt", ...extra, "--", "node", "-e", `console.log("deploy ok token ${tok}"); console.error("password=${pw}")`], { cwd: proj, encoding: "utf8", env: { ...process.env, USAGE_MAX_HOME: home } });
  // an older version left a world-readable folder and files behind, and an entry from 40 days ago
  fs.mkdirSync(cache, { recursive: true }); if (POSIX) fs.chmodSync(cache, 0o755);
  const old = path.join(cache, "0".repeat(32) + ".json"), oldArt = path.join(cache, "0".repeat(32) + ".art"), fresh = path.join(cache, "f".repeat(32) + ".json");
  fs.writeFileSync(old, JSON.stringify({ at: Date.now() - 40 * 864e5, ms: 1, stdout: "old" })); fs.mkdirSync(oldArt); fs.writeFileSync(path.join(oldArt, "r.txt"), "old artifact");
  fs.writeFileSync(fresh, JSON.stringify({ at: Date.now() - 864e5, ms: 1, stdout: "fresh" }));
  const r1 = go(); assert.equal(r1.status, 0); assert.match(r1.stdout, /deploy ok/, "the first (real) run shows the real output");
  const files = fs.readdirSync(cache).filter((f) => f.endsWith(".json") && f !== path.basename(old) && f !== path.basename(fresh));
  assert.equal(files.length, 1, "one new entry"); const stored = fs.readFileSync(path.join(cache, files[0]), "utf8");
  assert.ok(!stored.includes(tok) && !stored.includes(pw), "no secret in the stored file: " + stored); assert.match(stored, /\[redacted\]/);
  assert.equal(fs.existsSync(old), false, "an entry older than the cache lifetime is pruned"); assert.equal(fs.existsSync(oldArt), false, "and its artifacts"); assert.equal(fs.existsSync(fresh), true, "a recent entry stays");
  const r2 = go(); assert.match(r2.stderr, /HIT/); assert.ok(!r2.stdout.includes(tok) && !r2.stderr.includes(pw), "the replay does not bring the secret back");
  if (POSIX) {
    assert.equal(fs.statSync(cache).mode & 0o777, 0o700, "cache folder is private"); assert.equal(fs.statSync(path.join(cache, files[0])).mode & 0o777, 0o600, "entry file is private");
    fs.chmodSync(path.join(cache, files[0]), 0o644); go(); assert.equal(fs.statSync(path.join(cache, files[0])).mode & 0o777, 0o600, "a hit rewrite keeps it private");
  }
  const E = await imp("scripts/eval-cache.mjs"); assert.equal(typeof E.pruneCache, "function"); fs.writeFileSync(path.join(cache, "a".repeat(32) + ".json"), "{not json"); const past = new Date(Date.now() - 50 * 864e5); fs.utimesSync(path.join(cache, "a".repeat(32) + ".json"), past, past);
  E.pruneCache(cache, 30 * 864e5); assert.equal(fs.existsSync(path.join(cache, "a".repeat(32) + ".json")), false, "a corrupt old file is pruned by its age");
});

console.log(`${n} passing`);
