#!/usr/bin/env node
// eval-cache: skip re-running an eval/batch command when nothing it depends on changed.
//   node eval-cache.mjs [--key a,b,dir] [--salt s] [--ttl-days 30] [--artifacts dir] [--hold-red] [--force] -- <command...>
//   node eval-cache.mjs status | clear
// Key = hash of file/dir contents in --key (+ salt + command). Only exit-0 runs are cached. On hit: replays stdout/stderr,
// restores --artifacts, exits 0 without spending a token. Disable with USAGE_MAX_EVAL_CACHE=off.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const q = (a) => (process.platform === "win32" && /[\s"&|<>^%]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a);
const SKIP = new Set(["node_modules", ".git", "__pycache__", ".DS_Store"]);
const cacheDir = () => path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".usage-max", "eval-cache");
export function hashPaths(paths, h = crypto.createHash("sha256")) {
  const visit = (p) => {
    let st; try { st = fs.statSync(p); } catch { h.update("missing:" + p); return; }
    if (st.isDirectory()) { for (const n of fs.readdirSync(p).sort()) if (!SKIP.has(n)) { h.update("d:" + n); visit(path.join(p, n)); } }
    else { h.update("f:" + path.basename(p)); h.update(fs.readFileSync(p)); }
  };
  for (const p of paths) visit(p); return h;
}
// With no --key the inputs are "the project as it is now": the git HEAD plus every uncommitted and untracked change. Outside git there is no
// way to know what the command reads, so it is not cached at all (a cache that cannot notice changes would replay old output for weeks).
export function gitState(cwd = process.cwd()) {
  const g = (...a) => { const r = spawnSync("git", a, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }); return r.status === 0 ? r.stdout : null; };
  const head = g("rev-parse", "HEAD"); if (head === null) return null;
  const h = crypto.createHash("sha256"); h.update(head); h.update(g("diff", "HEAD") || "");
  for (const f of (g("ls-files", "-o", "--exclude-standard") || "").split("\n").filter(Boolean).sort()) { h.update("u:" + f); try { const fp = path.join(cwd, f), st = fs.statSync(fp); if (st.size > 5e6) h.update(`big:${st.size}:${st.mtimeMs}`); else h.update(fs.readFileSync(fp)); } catch (e) { h.update("unreadable"); } }
  return h.digest("hex");
}
export function keyFor({ keys, salt = "", cmd, git = null }) { const h = hashPaths(keys); if (git) h.update("git:" + git); h.update("salt:" + salt); h.update("cmd:" + cmd.join("\u0000")); return h.digest("hex").slice(0, 32); }

function main() {
  const argv = process.argv.slice(2); const sub = argv[0];
  if (sub === "status" || sub === "clear") {
    const d = cacheDir(); const fs_ = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")) : [];
    if (sub === "clear") { fs.rmSync(d, { recursive: true, force: true }); console.log(`cleared ${fs_.length} entries`); return 0; }
    let hits = 0; let saved = 0; for (const f of fs_) { const e = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); hits += e.hits || 0; saved += (e.hits || 0) * (e.ms || 0); }
    console.log(`eval-cache: ${fs_.length} entries, ${hits} hits, ~${Math.round(saved / 60000)} min of runs skipped`); return 0;
  }
  const dd = argv.indexOf("--"); if (dd < 0) { console.error("usage: eval-cache.mjs [--key a,b] [--salt s] [--ttl-days n] [--artifacts dir] [--hold-red] [--force] -- <command...>"); return 2; }
  const opt = argv.slice(0, dd), cmd = argv.slice(dd + 1); const flag = (n, d = null) => { const i = opt.indexOf("--" + n); return i >= 0 ? opt[i + 1] : d; };
  if (!cmd.length) return 2;
  const keys = (flag("key", "") || "").split(",").filter(Boolean), salt = flag("salt", ""), ttl = Number(flag("ttl-days", 30)) * 864e5, art = flag("artifacts");
  const run = () => { const r = spawnSync(q(cmd[0]), cmd.slice(1).map(q), { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell: process.platform === "win32" }); process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || ""); return { code: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" }; };
  if (process.env.USAGE_MAX_EVAL_CACHE === "off") return run().code;
  let git = null;
  if (!keys.length) { git = gitState(); if (!git) { console.error("[eval-cache] no --key given and this is not a git folder, so nothing can tell when the inputs change: running without the cache"); return run().code; } }
  const key = keyFor({ keys, salt, cmd, git }), file = path.join(cacheDir(), key + ".json"); let e = null;
  try { e = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  if (e && !opt.includes("--force") && Date.now() - e.at < ttl) {
    process.stdout.write(e.stdout || ""); process.stderr.write(e.stderr || "");
    if (art && e.artDir && fs.existsSync(e.artDir)) fs.cpSync(e.artDir, art, { recursive: true });
    e.hits = (e.hits || 0) + 1; fs.writeFileSync(file, JSON.stringify(e)); console.error(`[eval-cache] HIT ${key.slice(0, 8)} — skipped (${Math.round((e.ms || 0) / 1000)}s of work)`); return 0;
  }
  if (opt.includes("--hold-red")) {
    const g = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "governor.mjs"), "gate"], { stdio: "ignore" });
    if (g.status === 20) { console.error("[eval-cache] RED budget mode — run deferred (exit 75)"); return 75; }
  }
  const t0 = Date.now(), res = run(), code = res.code, ms = Date.now() - t0;
  if (code === 0) {
    fs.mkdirSync(cacheDir(), { recursive: true }); let artDir = null;
    if (art && fs.existsSync(art)) { artDir = path.join(cacheDir(), key + ".art"); fs.rmSync(artDir, { recursive: true, force: true }); fs.cpSync(art, artDir, { recursive: true }); }
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), ms, cmd, artDir, hits: 0, stdout: res.stdout.slice(0, 2e6), stderr: res.stderr.slice(0, 2e5) }));
  }
  return code;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
