// Durable recovery: backup / restore --check / restore --apply for the Codex side. Never overwrites a backup folder.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
import { HOME, codexHome, dataDir } from "./codex-governor.mjs"; import { binDir } from "./sync.mjs";
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const target = (rel) => { const [top, ...r] = rel.split("/"); const n = r.join("/"); if (!n || n.split("/").some((x) => x === ".." || x === "")) return null; return top === "codex" ? path.join(codexHome(), n) : top === "data" ? path.join(dataDir(), n) : null; };
function sources() {
  const out = []; const ver = path.join(binDir(), "VERSION"); out.push(["bin/VERSION", ver]);
  let names = []; try { names = fs.readdirSync(codexHome()); } catch {}
  for (const f of ["hooks.json", "config.toml", "AGENTS.md"]) out.push([`codex/${f}`, path.join(codexHome(), f)]);
  for (const f of names.sort()) if (/^usage-max-.*\.config\.toml$/.test(f) || f.endsWith(".usage-max-backup") || /\.usage-max-backup-\d{8}T/.test(f) || f.endsWith(".usage-max-diet-backup")) out.push([`codex/${f}`, path.join(codexHome(), f)]);
  for (const f of ["config.json", "governor.json", "trim-stats.json"]) out.push([`data/${f}`, path.join(dataDir(), f)]);
  return out;
}
export function backup(outDir) {
  const base = outDir ? path.resolve(outDir) : path.join(HOME(), ".usage-max-backups"); fs.mkdirSync(base, { recursive: true, mode: 0o700 }); // config.toml can hold tokens: keep backups private (POSIX; Windows uses your profile ACLs)
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, ""); let dir, k = 1;
  for (;; k++) { dir = path.join(base, `codex-${stamp}${k > 1 ? "-" + k : ""}`); try { fs.mkdirSync(dir, { mode: 0o700 }); break; } catch (e) { if (e.code !== "EEXIST") throw e; } }
  const files = [], skipped = [];
  for (const [rel, src] of sources()) {
    let b; try { b = fs.readFileSync(src); } catch { skipped.push(rel); continue; }
    const dst = path.join(dir, ...rel.split("/")); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, b, { flag: "wx", mode: 0o600 }); files.push({ path: rel, sha256: sha(b), bytes: b.length });
  }
  let version = null; try { version = fs.readFileSync(path.join(binDir(), "VERSION"), "utf8").trim(); } catch {}
  fs.writeFileSync(path.join(dir, "MANIFEST.json"), JSON.stringify({ createdAt: new Date().toISOString(), version, files, skipped }, null, 2), { flag: "wx", mode: 0o600 });
  return { dir, files, skipped };
}
export function check(dir) {
  let mf; try { mf = JSON.parse(fs.readFileSync(path.join(dir, "MANIFEST.json"), "utf8")); } catch (e) { return { ok: false, error: "MANIFEST.json missing or invalid", rows: [] }; }
  if (!mf || !Array.isArray(mf.files)) return { ok: false, error: "MANIFEST.json has no files list", rows: [] };
  let ok = true; const rows = [];
  for (const f of mf.files) {
    const row = { path: f.path, verified: false, state: "?" }; const t = f && typeof f.path === "string" ? target(f.path) : null;
    try { const b = fs.readFileSync(path.join(dir, ...String(f.path).split("/"))); row.verified = sha(b) === f.sha256 && b.length === f.bytes; } catch {}
    if (!row.verified && f.path !== undefined) ok = false;
    if (f.path === "bin/VERSION") row.state = "info only (not restored)"; else if (!t) { row.state = "unknown target"; ok = false; }
    else { try { row.state = sha(fs.readFileSync(t)) === f.sha256 ? "same as current" : "differs from current"; } catch { row.state = "missing now"; } }
    rows.push(row);
  }
  return { ok, rows, manifest: mf };
}
export function restore(dir, outDir) {
  const c = check(dir); if (!c.ok) return { error: c.error || "manifest check failed: " + c.rows.filter((r) => !r.verified).map((r) => r.path).join(", "), ...c };
  const pre = backup(outDir); const done = [];
  for (const f of c.manifest.files) {
    const t = target(f.path); if (!t) continue; const b = fs.readFileSync(path.join(dir, ...f.path.split("/")));
    fs.mkdirSync(path.dirname(t), { recursive: true }); const tmp = t + "." + process.pid + ".tmp"; fs.writeFileSync(tmp, b); try { fs.chmodSync(tmp, fs.statSync(t).mode & 0o777); } catch {} /* keep the original file mode */ fs.renameSync(tmp, t); done.push(f.path);
  }
  return { restored: done, preRestore: pre.dir };
}
