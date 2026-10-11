// Session guards (all pure/testable, every function takes the data dir): stale-cache warning, context-size nudge,
// runaway-loop detection, smart Read hints (re-read of an unchanged file, huge whole-file reads), subagent concurrency cap,
// event counters for the digest, and the low-priority task queue. Nothing here blocks work except the subagent cap;
// everything else only adds a message (to you via systemMessage = free, to Claude via additionalContext = a few tokens).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { recordCost } from "./pricing.mjs";
import { readJson, writeJsonAtomic } from "./meter.mjs";

const gdir = (dir) => path.join(dir, "guard");
const sfile = (dir, sid) => path.join(gdir(dir), `${String(sid || "unknown").replace(/[^\w.-]/g, "_").slice(0, 80)}.json`);
export const loadSession = (dir, sid) => readJson(sfile(dir, sid), null) || { last: 0, hashes: [], reads: {}, warned: {}, ctxNudge: 0 };
export function saveSession(dir, sid, s) {
  try {
    writeJsonAtomic(sfile(dir, sid), s);
    if (Math.random() < 0.05) { // housekeeping: forget sessions untouched for 3 days
      for (const f of fs.readdirSync(gdir(dir))) { const p = path.join(gdir(dir), f); try { if (Date.now() - fs.statSync(p).mtimeMs > 3 * 864e5) fs.unlinkSync(p); } catch {} }
    }
  } catch {}
}

// ---- counters for the digest (counts only; nothing about what you worked on)
export function bump(dir, name, n = 1) {
  try {
    const f = path.join(dir, "events.json"); const e = readJson(f, null) || { since: new Date().toISOString(), counts: {} };
    e.counts[name] = (e.counts[name] || 0) + n; writeJsonAtomic(f, e);
  } catch {}
}
export const loadEvents = (dir) => readJson(path.join(dir, "events.json"), null) || { since: null, counts: {} };

// ---- context size from the tail of the transcript (last assistant usage)
export function lastContext(transcript) {
  try {
    if (!transcript) return null;
    const fd = fs.openSync(transcript, "r");
    try {
      const size = fs.fstatSync(fd).size, len = Math.min(size, 256 * 1024), buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      for (const line of buf.toString("utf8").split("\n").reverse()) {
        if (!line.includes('"usage"')) continue;
        try { const u = JSON.parse(line)?.message?.usage; if (u) return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); } catch {}
      }
    } finally { fs.closeSync(fd); }
  } catch {}
  return null;
}
export function cacheTtlMs(home) {
  const s = readJson(path.join(home, ".claude", "settings.json"), {}) || {};
  return s.promptCacheTtl === "1h" ? 3600e3 : 300e3;
}
const k = (n) => `${Math.round(n / 1000)}k`;

// UserPromptSubmit: returns a message for YOU (systemMessage) or null. Updates "last activity".
export function promptCheck(dir, sid, { now = Date.now(), ctx = null, ttlMs = 300e3, compactAt = 150000, autoResume = false } = {}) {
  const s = loadSession(dir, sid); const gap = s.last ? now - s.last : 0; let msg = null;
  if (s.last && gap > ttlMs && ctx !== null && ctx >= 40000) {
    msg = `usage-max: this session sat idle ${Math.round(gap / 60000)} min, so its cache expired. Continuing re-bills the whole ${k(ctx)}-token context at about 10x a warm turn. Resuming an old big session is the costliest move (--resume/--continue re-reads it cold). ${autoResume ? "Cheapest for a big context: /clear now. A resume point (handoff) was saved automatically and the new session starts from it. For a quick follow-up, just carry on." : "Cheapest for a big context: ask me to /usage-max handoff, then /clear and continue from handoff.md. For a quick follow-up, just carry on."}`;
    bump(dir, "coldWarnings");
  } else if (ctx !== null && ctx >= compactAt && ctx >= (s.ctxNudge || 0) + 40000) {
    msg = `usage-max: context is ${k(ctx)} tokens and is re-read every turn. At a natural break run /compact (or hand off and /clear) to cut the cost of every following turn.`;
    s.ctxNudge = ctx; bump(dir, "compactNudges");
  }
  if (ctx !== null && ctx < (s.ctxNudge || 0) - 60000) s.ctxNudge = 0; // compacted: allow future nudges
  s.last = now; saveSession(dir, sid, s);
  return msg;
}
export function touch(dir, sid, now = Date.now()) { const s = loadSession(dir, sid); s.last = now; saveSession(dir, sid, s); }
export function resetReads(dir, sid) { const s = loadSession(dir, sid); s.reads = {}; s.hashes = []; saveSession(dir, sid, s); }

// ---- runaway loops: the SAME tool call repeated with no edit in between
const MUTATING = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
export const callHash = (tool, input) => { let h = 2166136261; for (const c of `${tool}\0${JSON.stringify(input || {}).slice(0, 600)}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
// Calls whose answer changes over time (waiting on notifications, tasks, CI, PR state) are polling, not a loop: never count them.
export const POLLING = /^(ReadNotifications|TaskList|TaskGet|TaskOutput|Monitor|CronList)$|^mcp__.*__(\w*_read|get_\w+|list_\w+)$/;
export function loopCheck(dir, sid, tool, input, { now = Date.now() } = {}) {
  if (POLLING.test(tool || "") || (input && typeof input === "object" && !Object.keys(input).length)) return null;
  const s = loadSession(dir, sid); s.last = now;
  if (MUTATING.has(tool)) s.hashes = []; // progress was made: start counting again
  else {
    const h = callHash(tool, input); s.hashes = [...(s.hashes || []), h].slice(-30);
    const same = s.hashes.filter((x) => x === h).length; const lvl = same >= 6 ? 2 : same >= 3 ? 1 : 0;
    if (lvl && (s.warned[h] || 0) < lvl) {
      s.warned[h] = lvl; bump(dir, "loopWarnings"); saveSession(dir, sid, s);
      const text = lvl === 1
        ? `usage-max: you have now made the identical ${tool} call ${same} times with no edit in between. Repeating it will not give a different answer. Change approach (read the error, check an assumption, try a different tool) before trying again.`
        : `usage-max: the identical ${tool} call has run ${same} times with no change in between: this looks like a loop burning the user's plan. Stop now, summarise what you tried and what you think is wrong, and ask the user how to proceed.`;
      return { additionalContext: text, systemMessage: lvl === 2 ? `usage-max: Claude repeated the same ${tool} call ${same} times; asking it to stop.` : null };
    }
  }
  saveSession(dir, sid, s); return null;
}

// ---- Read hints. Never blocks; never changes the read. Re-reads are the real waste: the file is already in context.
export function readCheck(dir, sid, input, { reset = false } = {}) {
  const p = input && input.file_path; if (!p || typeof p !== "string") return null;
  let st; try { st = fs.statSync(p); } catch { return null; }
  if (!st.isFile()) return null;
  const s = loadSession(dir, sid); if (reset) s.reads = {};
  const ranged = input.offset != null || input.limit != null; const prev = (s.reads || {})[p]; let hint = null;
  if (prev && prev.full && prev.mtimeMs === st.mtimeMs && prev.size === st.size && !ranged) {
    hint = `usage-max: ${path.basename(p)} was already read in full this session and has not changed since. Use what is already in your context; read only a specific range if you need a part you cannot see.`;
    bump(dir, "rereadHints");
  } else if (!ranged && st.size > 40000 && !prev) {
    hint = `usage-max: ${path.basename(p)} is ${Math.round(st.size / 1000)} KB (about ${k(st.size / 4)} tokens). Unless you need the whole file, Grep for the symbol and read just that range.`;
    bump(dir, "largeReadHints");
  }
  s.reads = { ...(s.reads || {}), [p]: { mtimeMs: st.mtimeMs, size: st.size, full: !ranged || (prev && prev.full && prev.mtimeMs === st.mtimeMs) } };
  const keys = Object.keys(s.reads); if (keys.length > 200) for (const x of keys.slice(0, keys.length - 200)) delete s.reads[x];
  saveSession(dir, sid, s); return hint;
}

// Whole-file Read of a huge file (default over 400 KB, ~100k tokens): refused ONCE with a way forward; asking again goes through.
// Off: config.json {"readBlock": false}, or set readBlockBytes.
export function readGate(dir, sid, input, { bytes } = {}) {
  const p = input && input.file_path; if (!p || typeof p !== "string" || input.offset != null || input.limit != null) return null;
  const c = readJson(path.join(dir, "config.json"), {}) || {}; if (c.readBlock === false) return null;
  if (/\.(png|jpe?g|gif|webp|bmp|ico|pdf|ipynb|svg|mp4|mov|zip)$/i.test(p)) return null; // images/PDFs/notebooks are read whole by design and cannot be grepped
  const max = bytes || Number(c.readBlockBytes) || 400000; let st; try { st = fs.statSync(p); } catch { return null; }
  if (!st.isFile() || st.size <= max) return null;
  const s = loadSession(dir, sid); s.blocked = s.blocked || {};
  if (s.blocked[p]) return null; // second ask: the user/model really wants it
  s.blocked[p] = Date.now(); const keys = Object.keys(s.blocked); if (keys.length > 100) for (const x of keys.slice(0, keys.length - 100)) delete s.blocked[x];
  saveSession(dir, sid, s); bump(dir, "bigReadsHeld");
  return { deny: `usage-max: ${path.basename(p)} is ${Math.round(st.size / 1000)} KB (about ${k(st.size / 4)} tokens), and a whole-file read would sit in the context for every following turn. Grep for what you need and Read a range (offset/limit). If you truly need the entire file, call Read again and it will go through.` };
}

// ---- subagent concurrency cap (each parallel subagent pays its own full startup context)
const CAPS = { green: 4, amber: 2, red: 1 };
const FLIGHT_TTL = 20 * 60e3;
export function agentCap(dir, mode, surplus) {
  const c = readJson(path.join(dir, "config.json"), {}) || {}; if (Number.isInteger(c.maxSubagents) && c.maxSubagents > 0) return c.maxSubagents;
  return (CAPS[mode] || 4) + (mode === "green" && surplus ? 1 : 0);
}
export function agentStart(dir, id, mode, surplus, now = Date.now()) {
  if (!id) return null; // cannot be released later without an id: do not track
  const f = path.join(dir, "inflight.json"); const live = Object.entries(readJson(f, {}) || {}).filter(([, t]) => now - t < FLIGHT_TTL);
  const cap = agentCap(dir, mode, surplus);
  if (live.length >= cap) { bump(dir, "subagentsHeld"); return { deny: `usage-max: ${live.length} subagents are already running (cap ${cap} in ${String(mode).toUpperCase()} mode; each one pays its own full startup context). Wait for them to finish, or fold this task into one of them or do it yourself.` }; }
  const o = Object.fromEntries(live); o[id || `a${now}`] = now; try { writeJsonAtomic(f, o); } catch {} return null;
}
export function agentEnd(dir, id) {
  try { const f = path.join(dir, "inflight.json"); const o = readJson(f, {}) || {}; if (id in o) { delete o[id]; writeJsonAtomic(f, o); } } catch {}
}

// ---- digest
export function digest(dir) {
  const e = loadEvents(dir), c = e.counts || {}; const L = [];
  const row = (n, text) => { if (c[n]) L.push(`  ${String(c[n]).padStart(5)}  ${text}`); };
  row("subagentDowngrades", "subagents moved from Opus/inherited to Sonnet");
  row("subagentsHeld", "extra parallel subagents held back by the concurrency cap");
  row("loopWarnings", "repeated-identical-call loops flagged");
  row("coldWarnings", "stale-cache resumes flagged (you chose handoff or carried on)");
  row("compactNudges", "big-context /compact reminders");
  row("rereadHints", "re-reads of an unchanged file flagged");
  row("codexCalls", "Claude->Codex calls seen (they spend the Codex plan)");
  row("codexCallsAsked", "of those, times you were asked first (Codex RED or 3rd+ round)");
  row("autoHandoffs", "free handoff files written when the cache went cold");
  row("offloadJobs", "jobs run on your local model instead of the plan");
  row("scriptFirstHints", "same-edit-in-many-files flagged (script it instead)");
  row("capNear", "session cap 80% warnings");
  row("capReached", "session cap reached warnings");
  row("largeReadHints", "whole-file reads of big files flagged");
  row("bigReadsHeld", "whole-file reads of huge files (400 KB+) held once for a ranged read");
  return { since: e.since, lines: L };
}

// ---- low-priority queue (worked through when the plan has spare allowance)
const qfile = (dir) => path.join(dir, "queue.json");
export const loadQueue = (dir) => { const q = readJson(qfile(dir), []); return Array.isArray(q) ? q : []; };
export function queueOp(dir, op, text) {
  const q = loadQueue(dir);
  if (op === "add") { if (!text) return { error: "usage: queue add <task>" }; q.push({ text: text.slice(0, 300), at: new Date().toISOString() }); writeJsonAtomic(qfile(dir), q); return { q }; }
  if (op === "next") { const t = q.shift(); writeJsonAtomic(qfile(dir), q); return { q, taken: t || null }; }
  if (op === "clear") { writeJsonAtomic(qfile(dir), []); return { q: [] }; }
  return { q };
}

// ---- cross-agent gate: Claude calling Codex (codex exec / codex review, e.g. from the codex-review and codex-dispatch plugins) spends the CODEX plan.
// Never auto-approves: it only adds a permission question ("ask") when Codex is RED, or when this session is already on its 3rd+ Codex call within an hour
// (each round of a back-and-forth re-sends the plan/diff). Everything is counted for the digest.
export const CODEX_CALL = /(^|[;&|(]\s*)((\w+=\S*\s+)*)(npx\s+(-y\s+)?)?(\S*[\\/])?codex(\.exe|\.cmd)?\s+(exec|review|e)\b/;
export function crossCheck(dir, sid, cmd, codexMode, { now = Date.now(), maxPerHour = 2 } = {}) {
  if (typeof cmd !== "string" || !CODEX_CALL.test(cmd)) return null;
  const s = loadSession(dir, sid); s.codexCalls = (s.codexCalls || []).filter((t) => now - t < 3600e3); s.codexCalls.push(now); saveSession(dir, sid, s); bump(dir, "codexCalls");
  const n = s.codexCalls.length;
  if (codexMode === "red") { bump(dir, "codexCallsAsked"); return `usage-max: your Codex plan is RED (nearly spent for this week). This call spends it further. Allow only if it is worth it; otherwise do the work here, or wait for the reset.`; }
  if (n > maxPerHour) { bump(dir, "codexCallsAsked"); return `usage-max: this is Codex call #${n} from this session in the last hour. Each round of a Claude<->Codex review re-sends the plan/diff to Codex. Two rounds usually catch most problems: stop here unless the last round found something serious.`; }
  return null;
}

// ---- script-first: the same edit made in 4+ different files is one codemod/sed, not four model turns.
export function editPattern(dir, sid, tool, input, { files = 4 } = {}) {
  if (tool !== "Edit" || !input || typeof input.old_string !== "string" || input.old_string.length < 3 || !input.file_path) return null;
  const s = loadSession(dir, sid); s.edits = s.edits || {}; const k = crypto.createHash("sha1").update(input.old_string + "\u0000" + String(input.new_string)).digest("hex").slice(0, 10);
  const set = new Set(s.edits[k] || []); set.add(input.file_path); s.edits[k] = [...set].slice(0, 20); if (Object.keys(s.edits).length > 40) s.edits = { [k]: s.edits[k] };
  let msg = null; if (set.size >= files && !(s.warned || {})["edit" + k]) { s.warned = { ...(s.warned || {}), ["edit" + k]: 1 }; msg = `usage-max: you have made the same edit in ${set.size} files. For the rest, write ONE small script (sed / codemod / node) that applies it to every file and run it, instead of one model turn per file; then review with git diff.`; bump(dir, "scriptFirstHints"); }
  saveSession(dir, sid, s); return msg;
}

// ---- optional per-session spend cap (list-price dollars, from the transcript). Off unless set: `usage-max cap <usd>`.
export function sessionCost(transcript) {
  let t; try { t = fs.readFileSync(transcript, "utf8"); } catch { return 0; } const seen = new Set(); let c = 0;
  for (const line of t.split("\n")) { if (!line.includes('"assistant"')) continue; let r; try { r = JSON.parse(line); } catch { continue; } const m = r && r.message; if (r.type !== "assistant" || !m) continue; if (m.id) { if (seen.has(m.id)) continue; seen.add(m.id); } c += recordCost(m); }
  return c;
}
export const capFile = (dir) => path.join(dir, "cap.json");
export const loadCap = (dir) => { const c = readJson(capFile(dir), null); return c && Number(c.usd) > 0 ? Number(c.usd) : null; };
export function capCheck(dir, sid, cost, cap) {
  if (!cap || !(cost > 0)) return null; const s = loadSession(dir, sid), lvl = cost >= cap ? 2 : cost >= cap * 0.8 ? 1 : 0; if (lvl <= (s.capLevel || 0)) return null;
  s.capLevel = lvl; saveSession(dir, sid, s); bump(dir, lvl === 2 ? "capReached" : "capNear");
  return lvl === 2 ? `usage-max: this session has used about $${cost.toFixed(2)} at list price, over your $${cap} session cap. Finish or hand off (/usage-max handoff), then start fresh; or raise it: usage-max cap <usd>.` : `usage-max: this session is at about $${cost.toFixed(2)} of your $${cap} cap (80%).`;
}
