// Session log: the complete, cheap record of what the user asked in past sessions of a project. Written at every Stop from the transcript
// bytes added since the last Stop (a byte offset per session), so a long conversation is never re-read. Nothing here is injected into the
// model's context; it feeds `usage-max memory suggestions` and `usage-max memory search` (no model calls, no network).
// Stored OUTSIDE the repo (git stays clean), private (0600 / 0700), redacted, capped (2000 lines, 90 days). Fail-open: a Stop never fails because of it.
// Dependency-light on purpose (memory.mjs + safefile.mjs): the Codex hooks copy this file next to themselves.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { redact } from "./memory.mjs";
import { writeAtomic, withLock, canonPath } from "./safefile.mjs";

export const MAX_LINES = 2000, MAX_AGE_MS = 90 * 864e5, MAX_TEXT = 200, MAX_FILES = 30;
const CHUNK = 256 * 1024, MAX_PER_STOP = 8 * 1024 * 1024, MAX_LINE = 2 * 1024 * 1024, PRUNE_EVERY_MS = 12 * 36e5, MAX_SESSIONS = 40;
const POSIX = process.platform !== "win32";
const ignore = (e) => e; // deliberate: a failed best-effort step (chmod, error note) never stops the hook
const sha = (s, n) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, n);
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export const homeOf = (env = process.env) => env.USAGE_MAX_HOME || os.homedir();
export const logDir = (env = process.env) => path.join(homeOf(env), ".usage-max", "session-log");
export const enabled = (cfg) => !(cfg && (cfg.memory === "off" || cfg.sessionLog === "off"));

// The project is the folder holding .git or .memory (so a session started in a subfolder lands in the same log); otherwise the folder itself.
export function projectRoot(cwd) {
  let d = path.resolve(String(cwd || process.cwd()));
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(d, ".git")) || fs.existsSync(path.join(d, ".memory"))) return d;
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return path.resolve(String(cwd || process.cwd()));
}
export const logFileFor = (root, env = process.env) => path.join(logDir(env), `${slug(path.basename(root)) || "project"}-${sha(canonPath(root), 8)}.jsonl`);

// ---- private files and folders (POSIX modes; Windows has no equivalent here)
function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (POSIX) { try { fs.chmodSync(dir, 0o700); } catch (e) { ignore(e); } }
}
function privateAppend(file, text) {
  fs.appendFileSync(file, text, { mode: 0o600 });
  if (POSIX) { try { fs.chmodSync(file, 0o600); } catch (e) { ignore(e); } }
}

// ---- what counts as something the person typed
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// secrets and email addresses never reach the log
export const scrub = (t) => redact(String(t || "")).replace(EMAIL, "[email]");
const oneLine = (t) => String(t || "").replace(/\s+/g, " ").trim();
export function clipText(t, n = MAX_TEXT) { const s = oneLine(t); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
const BLOCKS = /<(system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|project-notes|resume-note|user-prompt-submit-hook|environment_context)\b[^>]*>[\s\S]*?<\/\1>/gi;
const WRAPPER = /^<\/?(system-reminder|command-name|command-message|command-args|local-command-caveat|local-command-stdout|local-command-stderr|user-prompt-submit-hook|task-notification|bash-input|bash-stdout|bash-stderr|project-notes|resume-note|environment_context|user_instructions|instructions)\b/i;
const SYNTH = /^(\[Request interrupted|Caveat:|This session is being continued from a previous conversation|# AGENTS\.md instructions|<INSTRUCTIONS>)/;
// -> the person's own words, or "" when the text is tool output, a hook/system injection, a slash-command wrapper or a compaction summary
export function genuineText(raw) {
  const t = String(raw || "").replace(BLOCKS, "").trim();
  if (!t || WRAPPER.test(t) || SYNTH.test(t)) return "";
  return t;
}
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

// One transcript line -> { users: [{text, time}], files: [paths] }. `tool` is the host that wrote it.
export function parseLine(s, tool = "claude") {
  const out = { users: [], files: [] }; let o; try { o = JSON.parse(s); } catch (e) { ignore(e); return out; }
  if (!o || typeof o !== "object") return out;
  const time = typeof o.timestamp === "string" && !Number.isNaN(Date.parse(o.timestamp)) ? o.timestamp : null;
  if (tool === "codex") {
    const pl = o.payload || {};
    if (o.type === "event_msg" && pl.type === "user_message") { const t = genuineText(pl.message); if (t) out.users.push({ text: t, time }); }
    if (/apply_patch|\*\*\* (Update|Add) File/.test(s)) for (const m of s.matchAll(/\*\*\* (?:Update|Add) File: ([^"\\\n]+)/g)) out.files.push(m[1].trim());
    return out;
  }
  const m = o.message; if (!m || typeof m !== "object") return out;
  if (o.type === "user") {
    if (o.isSidechain || o.isMeta || o.isCompactSummary || o.toolUseResult !== undefined || m.role !== "user") return out;
    let text = "";
    if (typeof m.content === "string") text = m.content;
    else if (Array.isArray(m.content)) { if (m.content.some((b) => b && b.type === "tool_result")) return out; text = m.content.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n"); }
    const g = genuineText(text); if (g) out.users.push({ text: g, time });
  } else if (o.type === "assistant" && Array.isArray(m.content)) {
    for (const b of m.content) if (b && b.type === "tool_use" && EDITS.has(b.name) && b.input) { const p = b.input.file_path || b.input.notebook_path; if (typeof p === "string" && p) out.files.push(p); }
  }
  return out;
}
// the host's lines worth parsing at all (a cheap test on the raw bytes, so big tool results are never parsed)
function wanted(line, tool) {
  if (tool === "codex") return line.includes("user_message") || line.includes("apply_patch") || line.includes("*** ");
  if (line.includes('"tool_result"')) return false;
  return line.includes('"user"') || (line.includes('"tool_use"') && (line.includes("Edit") || line.includes("Write")));
}
const projectRel = (root, cwd, p) => {
  const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p); const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null; return rel.replace(/\\/g, "/");
};

// ---- reading only the new bytes, in chunks. onLine(Buffer) for each complete line; returns { end, size }: `end` is the offset after the last line consumed
export function scanLines(file, start, maxBytes, onLine) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size; if (start > size) start = 0; // the file is shorter than where we stopped: it was replaced
    const buf = Buffer.alloc(CHUNK); let pos = start, consumed = start, carry = Buffer.alloc(0), skipping = false, stop = false;
    while (pos < size && pos - start < maxBytes && !stop) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos); if (!n) break;
      let data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n); const base = pos - carry.length; let from = 0;
      if (skipping) { const nl = data.indexOf(10); if (nl < 0) { pos += n; consumed = pos; carry = Buffer.alloc(0); continue; } from = nl + 1; skipping = false; }
      for (;;) { const nl = data.indexOf(10, from); if (nl < 0) break; if (onLine(data.subarray(from, nl)) === true) stop = true; from = nl + 1; if (stop) break; }
      consumed = base + from; carry = Buffer.from(data.subarray(from)); pos += n;
      if (carry.length > MAX_LINE) { carry = Buffer.alloc(0); skipping = true; consumed = pos; } // one gigantic line (a pasted file): dropped, never held in memory
    }
    if (!stop && pos >= size && carry.length && carry.length < MAX_LINE) { try { JSON.parse(carry.toString("utf8")); onLine(carry); consumed = size; } catch (e) { ignore(e); } } // a complete last line without the trailing newline
    return { end: consumed, size };
  } finally { fs.closeSync(fd); }
}

// ---- the log file: one JSON object per line; a corrupt line is skipped
export function readLog(file) {
  let text = ""; try { text = fs.readFileSync(file, "utf8"); } catch (e) { ignore(e); return []; }
  const out = [];
  for (const l of text.split("\n")) { if (!l) continue; try { const o = JSON.parse(l); if (o && typeof o === "object" && (o.type === "user" || o.type === "files")) out.push(o); } catch (e) { ignore(e); } }
  return out;
}
const readState = (f) => { try { const o = JSON.parse(fs.readFileSync(f, "utf8")); return o && typeof o === "object" ? o : {}; } catch (e) { ignore(e); return {}; } };
const noteError = (env, reason) => { try { privateDir(logDir(env)); writeAtomic(path.join(logDir(env), "last-error.json"), JSON.stringify({ at: new Date().toISOString(), reason: String(reason).slice(0, 300) }), { mode: 0o600 }); } catch (e) { ignore(e); } };

function prune(file, now, maxLines) {
  let kept = readLog(file).filter((o) => { const t = Date.parse(o.time); return Number.isNaN(t) || now - t <= MAX_AGE_MS; });
  if (kept.length > maxLines) kept = kept.slice(-maxLines);
  writeAtomic(file, kept.length ? kept.map((o) => JSON.stringify(o)).join("\n") + "\n" : "", { mode: 0o600 });
  return kept.length;
}

// Called by the Stop hooks. Never throws. -> { added, files } | { skipped } | { error }
export function recordStop({ cwd, sessionId, transcript, tool = "claude", cfg, env = process.env, now = Date.now(), maxLines = MAX_LINES } = {}) {
  try {
    if (!enabled(cfg)) return { skipped: "off" };
    if (!cwd || !transcript) return { skipped: "no transcript" };
    const root = projectRoot(cwd), file = logFileFor(root, env), sf = file.replace(/\.jsonl$/, ".state.json");
    const sid = String(sessionId || path.basename(String(transcript))).slice(0, 80), tp = sha(canonPath(transcript), 10);
    let size; try { size = fs.statSync(transcript).size; } catch (e) { ignore(e); return { skipped: "transcript not readable" }; }
    const quick = (readState(sf).sessions || {})[sid]; if (quick && quick.p === tp && quick.off >= size) return { added: 0, files: 0 }; // nothing new since the last Stop: no lock, no read
    privateDir(logDir(env));
    const r = withLock(file, () => {
      const state = readState(sf); state.sessions = state.sessions || {};
      let ss = state.sessions[sid]; if (!ss || ss.p !== tp) ss = { p: tp, off: 0, files: [] };
      const seen = ss.off === 0 || ss.off > size ?new Set(readLog(file).filter((o) => o.type === "user").map((o) => `${o.time}|${o.text}`)) : null; // a resumed conversation replays old messages: never log them twice
      const users = [], found = [];
      const scan = scanLines(transcript, ss.off, MAX_PER_STOP, (line) => {
        if (line.length > MAX_LINE || !wanted(line, tool)) return false;
        const p = parseLine(line.toString("utf8"), tool);
        for (const u of p.users) users.push(u);
        for (const f of p.files) found.push(f);
        return false;
      });
      const stamp = new Date(now).toISOString(), rows = [];
      for (const u of users) {
        const text = clipText(scrub(u.text.slice(0, 4000))); if (text.length < 2) continue;
        const time = u.time || stamp, k = `${time}|${text}`; if (seen) { if (seen.has(k)) continue; seen.add(k); }
        rows.push({ type: "user", time, session: sid, text });
      }
      const have = new Set(ss.files), fresh = [];
      for (const f of found) { const rel = projectRel(root, cwd, f); if (!rel || have.has(rel) || have.size >= MAX_FILES) continue; const c = clipText(scrub(rel), 200); have.add(rel); fresh.push(c); }
      if (fresh.length) rows.push({ type: "files", time: stamp, session: sid, files: fresh });
      if (rows.length) privateAppend(file, rows.map((o) => JSON.stringify(o)).join("\n") + "\n");
      ss.off = scan.end; ss.files = [...have]; ss.at = now; state.sessions[sid] = ss;
      state.lines = (Number.isFinite(state.lines) ? state.lines : -1) + rows.length;
      if (state.lines < 0 || state.lines > maxLines || !state.prunedAt || now - state.prunedAt > PRUNE_EVERY_MS) { state.lines = prune(file, now, maxLines); state.prunedAt = now; }
      const keep = Object.entries(state.sessions).filter(([, v]) => v && now - (v.at || 0) <= MAX_AGE_MS).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, MAX_SESSIONS);
      state.sessions = Object.fromEntries(keep);
      writeAtomic(sf, JSON.stringify(state), { mode: 0o600 });
      return { added: rows.filter((x) => x.type === "user").length, files: fresh.length };
    }, { waitMs: 400 });
    if (!r.ok) return { skipped: r.busy ? "busy (retried at the next Stop)" : "could not lock" };
    return r.value;
  } catch (e) { const reason = (e && (e.code || e.message)) || String(e); noteError(env, reason); return { error: String(reason) }; }
}
