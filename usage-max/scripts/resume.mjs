// Automatic resume point ("handoff without a model"): built from the session transcript + git, written at every Stop, read at the next
// SessionStart in the same folder. Costs no model tokens. Kept outside the repo (dataDir/resume/<folder>.md) so it never dirties git.
// Dependency-free.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b && b.type === "text").map((b) => b.text).join(" ") : "";
const SYNTH = /^<(system-reminder|command-|local-command|user-prompt-submit-hook)|^\[Request interrupted|^Caveat:/;
export const resumeFile = (dir, cwd) => path.join(dir, "resume", crypto.createHash("sha1").update(path.resolve(cwd)).digest("hex").slice(0, 12) + ".md");

export function tailLines(file, bytes = 600 * 1024) {
  const fd = fs.openSync(file, "r");
  try { const size = fs.fstatSync(fd).size, len = Math.min(size, bytes), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); return buf.toString("utf8").split("\n").slice(size > len ? 1 : 0); }
  finally { fs.closeSync(fd); }
}
export function digestTranscript(file) {
  const users = [], files = []; let last = "", model = null;
  for (const line of tailLines(file)) {
    if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
    const m = o.message; if (!m) continue;
    if (o.type === "user" && !o.isSidechain) { const t = textOf(m.content); if (t && !SYNTH.test(t.trim())) users.push(clip(t, 220)); }
    else if (o.type === "assistant" && !o.isSidechain) {
      if (m.model) model = m.model; const t = textOf(m.content); if (t) last = t;
      if (Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_use" && EDITS.has(b.name) && b.input && (b.input.file_path || b.input.notebook_path)) files.push(b.input.file_path || b.input.notebook_path);
    }
  }
  return { users: users.slice(-4), last: clip(last, 500), files: [...new Set(files.reverse())].slice(0, 12), model };
}
const git = (cwd, args) => { try { const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }); return r.status === 0 ? r.stdout.trim() : ""; } catch { return ""; } };

export function buildResume({ transcript, cwd, now = new Date() }) {
  let d = { users: [], last: "", files: [] }; try { if (transcript) d = digestTranscript(transcript); } catch {}
  if (!d.users.length && !d.files.length) return null;
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]); const dirty = git(cwd, ["status", "--short"]).split("\n").filter(Boolean);
  const L = [`Resume point (saved automatically ${now.toISOString().slice(0, 16)}Z, no model used)`, `Folder: ${cwd}${branch ? `  branch: ${branch}` : ""}`];
  if (d.users.length) L.push("Last things the user asked:", ...d.users.map((u) => `- ${u}`));
  if (d.last) L.push(`Where it stopped (last assistant message): ${d.last}`);
  if (d.files.length) L.push(`Files edited most recently: ${d.files.join(", ")}`);
  if (dirty.length) L.push(`Uncommitted: ${dirty.slice(0, 10).join("; ")}${dirty.length > 10 ? ` (+${dirty.length - 10} more)` : ""}`);
  return L.join("\n");
}
export function saveResume(dir, cwd, text, { now = Date.now(), minGapMs = 60e3 } = {}) {
  if (!text) return false; const f = resumeFile(dir, cwd);
  try { if (now - fs.statSync(f).mtimeMs < minGapMs) return false; } catch {}
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text + "\n"); return true; } catch { return false; }
}
// Once per saved version, and only for a fresh/cleared session (a resumed or compacted one already has its context).
export function takeResume(dir, cwd, { maxAgeMs = 7 * 864e5, now = Date.now(), cap = 1400 } = {}) {
  const f = resumeFile(dir, cwd); let st; try { st = fs.statSync(f); } catch { return null; }
  if (now - st.mtimeMs > maxAgeMs) return null;
  const mark = f + ".taken"; try { if (Number(fs.readFileSync(mark, "utf8")) >= Math.floor(st.mtimeMs)) return null; } catch {}
  try { fs.writeFileSync(mark, String(Math.floor(st.mtimeMs))); } catch {}
  const t = fs.readFileSync(f, "utf8"); return t.length > cap ? t.slice(0, cap) + "…" : t;
}
