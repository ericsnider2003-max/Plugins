// Safe edits of files that belong to the user (config.toml, settings.json, AGENTS.md, hooks.json).
// Rules: a file that cannot be READ is never treated as empty (only "does not exist" is); every change is written to a unique temp file and
// renamed into place (a crash or a second process never leaves half a file); the previous content is kept as a timestamped backup first.
// Dependency-free. Identical copy at codex/scripts/safefile.mjs (tests enforce it) because the Codex side runs from its own folder.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Deliberate: a failed best-effort step (backup pruning, temp-file cleanup) must never stop or undo the edit itself.
const ignore = (e) => e;

// -> text, or null when the file does not exist. Any other failure (locked, permission, a directory) throws: the caller must leave the file alone.
export function readText(file) { try { return fs.readFileSync(file, "utf8"); } catch (e) { if (e && e.code === "ENOENT") return null; throw e; } }
export function writeAtomic(file, text, { mode } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try { fs.writeFileSync(tmp, text, mode ? { mode } : undefined); fs.renameSync(tmp, file); }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch (e) { ignore(e); } throw e; }
}
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.(\d+)Z$/, "$1Z");
// Copies the current content to `<file>.usage-max-backup-<timestamp>` unless the newest backup is already identical; keeps the newest `keep`.
export function backupFile(file, { keep = 5, now = new Date() } = {}) {
  const cur = readText(file); if (cur === null) return null;
  try { fs.writeFileSync(file + ".usage-max-backup", cur, { flag: "wx" }); } catch (e) { ignore(e); /* the untouched original is kept once; it already exists */ }
  const dir = path.dirname(file), base = path.basename(file) + ".usage-max-backup-";
  const all = fs.readdirSync(dir).filter((n) => n.startsWith(base)).sort();
  if (all.length) { try { if (fs.readFileSync(path.join(dir, all[all.length - 1]), "utf8") === cur) return path.join(dir, all[all.length - 1]); } catch (e) { ignore(e); } }
  const out = path.join(dir, base + stamp(now)); fs.writeFileSync(out, cur);
  for (const n of [...all, path.basename(out)].sort().slice(0, -keep)) try { fs.rmSync(path.join(dir, n), { force: true }); } catch (e) { ignore(e); }
  return out;
}
// Cross-process lock for a read-modify-write: an atomically created `<file>.lock` folder. Waits up to waitMs, steals a lock older than staleMs
// (its owner died). -> { ok: true, value } or { ok: false } when busy: the caller skips this round (it is retried at the next hook) rather than racing.
export function withLock(file, fn, { waitMs = 2000, staleMs = 15000 } = {}) {
  const lock = file + ".lock", t0 = Date.now(); fs.mkdirSync(path.dirname(file), { recursive: true });
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (e) {
      if (!e || e.code !== "EEXIST") return { ok: false };
      try { if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) { fs.rmdirSync(lock); continue; } } catch (e2) { ignore(e2); }
      if (Date.now() - t0 > waitMs) return { ok: false };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 + (process.pid % 30));
    }
  }
  try { return { ok: true, value: fn() }; } finally { try { fs.rmdirSync(lock); } catch (e) { ignore(e); } }
}
// editText(file, fn): fn(currentText | "") -> next text (or null/undefined = leave alone). Returns { changed, backup?, error? }; never throws.
export function editText(file, fn, opts = {}) {
  const r = withLock(file, () => editTextUnlocked(file, fn, opts));
  return r.ok ? r.value : { changed: false, error: `${path.basename(file)} is being changed by another process; try again in a moment` };
}
function editTextUnlocked(file, fn, { backup = true } = {}) {
  let cur; try { cur = readText(file); } catch (e) { return { changed: false, error: `could not read ${path.basename(file)} (${e.code || e.message}); left untouched` }; }
  let next; try { next = fn(cur === null ? "" : cur); } catch (e) { return { changed: false, error: String(e && e.message || e) }; }
  if (next === null || next === undefined || next === cur) return { changed: false };
  try { const b = cur === null || !backup ? null : backupFile(file); writeAtomic(file, next); return { changed: true, ...(b ? { backup: b } : {}) }; }
  catch (e) { return { changed: false, error: `could not write ${path.basename(file)} (${e.code || e.message}); left as it was` }; }
}
