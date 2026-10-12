// Automatic resume point ("handoff without a model"): built from the session transcript + git, written at every Stop, read at the next
// SessionStart in the same folder. Costs no model tokens. Kept outside the repo (dataDir/resume/<folder>.md) so it never dirties git.
// Dependency-free.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redact } from "./memory.mjs";

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b && b.type === "text").map((b) => b.text).join(" ") : "";
const SYNTH = /^<(system-reminder|command-|local-command|user-prompt-submit-hook)|^\[Request interrupted|^Caveat:/;
// ONE resume note per folder, shared by Claude Code and Codex: start in whichever plan has room and the other tool can pick it up.
export const sharedDir = (env = process.env) => path.join(env.USAGE_MAX_HOME || os.homedir(), ".usage-max");
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
// Codex rollout files: tolerant of format drift (message events, response items, apply_patch calls). Anything unparseable is skipped.
const CODEX_NOISE = /^<environment_context|^# AGENTS\.md instructions|^<user_instructions|^<INSTRUCTIONS>|^<system-reminder/;
export function digestCodex(file) {
  const users = [], files = []; let last = "", model = null;
  for (const line of tailLines(file)) {
    if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
    const pl = o.payload || {}; let role = null, text = "";
    if (o.type === "turn_context" && pl.model) model = pl.model;
    if (o.type === "event_msg" && pl.type === "user_message") { role = "user"; text = pl.message || ""; }
    else if (o.type === "event_msg" && pl.type === "agent_message") { role = "assistant"; text = pl.message || ""; }
    else if (o.type === "response_item" && pl.type === "message") {
      role = pl.role; text = Array.isArray(pl.content) ? pl.content.map((b) => (b && (b.text || "")) || "").join(" ") : String(pl.content || "");
    }
    if (role === "user" && text && !CODEX_NOISE.test(text.trim())) users.push(clip(text, 220));
    else if (role === "assistant" && text) last = text;
    if (line.includes("apply_patch") || line.includes("*** Update File") || line.includes("*** Add File")) for (const m of line.matchAll(/\*\*\* (?:Update|Add) File: ([^"\\\n]+)/g)) files.push(m[1].trim());
  }
  // consecutive duplicates (the same prompt appears as event + response item)
  const u = users.filter((x, i) => x !== users[i - 1]);
  return { users: u.slice(-4), last: clip(last, 500), files: [...new Set(files.reverse())].slice(0, 12), model };
}
// Where Codex put this session's rollout file when the hook did not say.
export function findRollout({ transcript, sessionId, codexHome, now = Date.now() }) {
  try { if (transcript && fs.existsSync(transcript)) return transcript; } catch {}
  const root = path.join(codexHome, "sessions"); let best = null;
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) { let st; try { st = fs.statSync(p); } catch { continue; } const hit = sessionId && e.name.includes(sessionId); if (!hit && now - st.mtimeMs > 10 * 60e3) continue; const score = (hit ? 1e15 : 0) + st.mtimeMs; if (!best || score > best.score) best = { p, score }; }
    }
  };
  walk(root, 0); return best && best.p;
}
const git = (cwd, args) => { try { const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }); return r.status === 0 ? r.stdout.trim() : ""; } catch { return ""; } };

export function buildResume({ transcript, cwd, now = new Date(), tool = "claude" }) {
  let d = { users: [], last: "", files: [] }; try { if (transcript) d = tool === "codex" ? digestCodex(transcript) : digestTranscript(transcript); } catch {}
  if (!d.users.length && !d.files.length) return null;
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]); const dirty = git(cwd, ["status", "--short"]).split("\n").filter(Boolean);
  const L = [`Resume point from ${tool === "codex" ? "Codex" : "Claude Code"} (saved automatically ${now.toISOString().slice(0, 16)}Z, no model used)`, `Folder: ${cwd}${branch ? `  branch: ${branch}` : ""}`];
  if (d.users.length) L.push("Last things the user asked:", ...d.users.map((u) => `- ${u}`));
  if (d.last) L.push(`Where it stopped (last assistant message): ${d.last}`);
  if (d.files.length) L.push(`Files edited most recently: ${d.files.join(", ")}`);
  if (dirty.length) L.push(`Uncommitted: ${dirty.slice(0, 10).join("; ")}${dirty.length > 10 ? ` (+${dirty.length - 10} more)` : ""}`);
  if (transcript) L.splice(2, 0, `Full earlier conversation, word for word: ${String(transcript).replace(/\\/g, "/")} - search it (grep) for any detail before asking the user to repeat something.`); // second line: a size cap can never cut it off
  return redact(L.join("\n"));
}
export function saveResume(dir, cwd, text, { now = Date.now(), minGapMs = 60e3 } = {}) {
  const f = resumeFile(dir, cwd); // `text` may be a function: it is called only AFTER the throttle check, so a Stop inside the gap costs no transcript read or git call
  let last = 0; try { last = fs.statSync(f).mtimeMs; } catch (e) { last = 0; } // no earlier note: nothing to throttle against
  if (last && now - last < minGapMs) return false;
  if (typeof text === "function") text = text(); if (!text) return false;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text + "\n"); return true; } catch { return false; }
}
// After a compaction the summary can drop detail: show the current note again WITHOUT consuming it (it describes this same session).
export function peekResume(dir, cwd, { maxAgeMs = 864e5, now = Date.now(), cap = 1800, mustInclude = null } = {}) {
  const f = resumeFile(dir, cwd); let st; try { st = fs.statSync(f); } catch { return null; }
  if (now - st.mtimeMs > maxAgeMs) return null; const t = fs.readFileSync(f, "utf8");
  if (mustInclude && !t.includes(String(mustInclude).replace(/\\/g, "/"))) return null; // a note from another session in this folder is not this conversation
  return t.length > cap ? t.slice(0, cap) + "…" : t;
}
// Once per saved version, and only for a fresh/cleared session (a resumed or compacted one already has its context).
export function takeResume(dir, cwd, { maxAgeMs = 7 * 864e5, now = Date.now(), cap = 1400, tool = "claude" } = {}) {
  const f = resumeFile(dir, cwd); let st; try { st = fs.statSync(f); } catch { return null; }
  if (now - st.mtimeMs > maxAgeMs) return null;
  const mark = f + ".taken-" + tool; try { if (Number(fs.readFileSync(mark, "utf8")) >= Math.floor(st.mtimeMs)) return null; } catch {}
  try { fs.writeFileSync(mark, String(Math.floor(st.mtimeMs))); } catch {}
  const t = fs.readFileSync(f, "utf8"); return t.length > cap ? t.slice(0, cap) + "…" : t;
}
