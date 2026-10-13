// `usage-max memory search <words>`: the fallback that does not depend on any suggestion list being complete. Looks for the words in
//   (a) the session log (what you asked, per project)   (b) .memory decisions and topics   (c) this project's Claude transcripts of the last 60 days.
// Prints where each hit was found plus a redacted snippet (<= 160 chars), newest first, max 20 hits and 4 KB, with the file path so the
// complete conversation can be opened. Transcripts are read in chunks, never loaded whole. Read-only; no model, no network.
import fs from "node:fs";
import path from "node:path";
import { listTopics, readDecisions } from "./memory.mjs";
import { genuineText, homeOf, logFileFor, projectRoot, readLog, scanLines, scrub } from "./sessionlog.mjs";

export const MAX_HITS = 20, MAX_BYTES = 4000, SNIPPET = 160, DAYS = 60;
const SCAN_BUDGET_BYTES = 400 * 1024 * 1024, SCAN_BUDGET_MS = 6000, PER_FILE = 40;
const ignore = (e) => e;
export const mangle = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-"); // how Claude Code names a project's transcript folder
const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "unknown");

export function snippet(text, words) {
  const s = String(text || "").replace(/\s+/g, " ").trim(), low = s.toLowerCase(); let at = -1;
  for (const w of words) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = Math.max(0, at - 50), body = scrub(s.slice(start, start + SNIPPET - 4)); // redacted AFTER cutting around the match, within the cap
  const out = (start > 0 ? "…" : "") + body + (start + SNIPPET - 4 < s.length ? "…" : "");
  return out.length > SNIPPET ? out.slice(0, SNIPPET - 1) + "…" : out;
}
const hasAll = (text, words) => { const low = String(text || "").toLowerCase(); return words.every((w) => low.includes(w)); };

export function transcriptDirs(cwd, root, env = process.env) {
  const base = path.join(homeOf(env), ".claude", "projects"), seen = new Set(), out = [];
  for (const p of [cwd, root]) { const d = path.join(base, mangle(path.resolve(p))); if (!seen.has(d)) { seen.add(d); try { if (fs.statSync(d).isDirectory()) out.push(d); } catch (e) { ignore(e); } } }
  return out;
}
function textOfLine(s) { // user and assistant words only (tool output is neither searched nor shown)
  let o; try { o = JSON.parse(s); } catch (e) { ignore(e); return null; }
  const m = o && o.message; if (!m || (o.type !== "user" && o.type !== "assistant") || o.isMeta) return null;
  let text = ""; if (typeof m.content === "string") text = m.content; else if (Array.isArray(m.content)) { if (m.content.some((b) => b && b.type === "tool_result")) return null; text = m.content.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n"); }
  if (o.type === "user") { text = genuineText(text); }
  return text ? { text, who: o.type === "user" ? "you" : "assistant", time: Date.parse(o.timestamp) || null } : null;
}

export function search(words, { cwd = process.cwd(), mem = null, env = process.env, now = Date.now(), maxHits = MAX_HITS, maxBytes = MAX_BYTES } = {}) {
  words = [...new Set(words.map((w) => String(w).toLowerCase().trim()).filter((w) => w.length >= 2))];
  const root = projectRoot(cwd), hits = [], looked = [];
  // (a) session log
  const lf = logFileFor(root, env), entries = readLog(lf); looked.push(`session log (${entries.length} entr${entries.length === 1 ? "y" : "ies"}: ${lf})`);
  for (const e of entries) { const text = e.type === "user" ? e.text : (e.files || []).join(", "); if (hasAll(text, words)) hits.push({ time: Date.parse(e.time) || 0, where: e.type === "user" ? "session log (you asked)" : "session log (files edited)", file: lf, snip: snippet(text, words) }); }
  // (b) .memory
  if (mem) {
    looked.push(`.memory decisions and topics (${mem})`);
    try { for (const d of readDecisions(mem)) if (hasAll(`${d.key} ${d.value}`, words)) hits.push({ time: Date.parse(d.date) || 0, where: ".memory decision", file: path.join(mem, "decisions.md"), snip: snippet(`${d.key}: ${d.value}`, words) }); } catch (e) { ignore(e); }
    try { for (const t of listTopics(mem)) { let mt = 0; try { mt = fs.statSync(t.file).mtimeMs; } catch (e) { ignore(e); } for (const l of t.text.split(/\r?\n/)) if (l.trim() && hasAll(l, words)) hits.push({ time: mt, where: `.memory topic ${t.slug}`, file: t.file, snip: snippet(l.replace(/^[-*#>\s]+/, ""), words) }); } } catch (e) { ignore(e); }
  } else looked.push("no .memory here");
  // (c) Claude transcripts, last 60 days, newest file first, chunked
  const dirs = transcriptDirs(cwd, root, env); let files = [];
  for (const d of dirs) { let names = []; try { names = fs.readdirSync(d).filter((n) => n.endsWith(".jsonl")); } catch (e) { ignore(e); } for (const n of names) { const p = path.join(d, n); try { const st = fs.statSync(p); if (now - st.mtimeMs <= DAYS * 864e5) files.push({ p, mtime: st.mtimeMs }); } catch (e) { ignore(e); } } }
  files.sort((a, b) => b.mtime - a.mtime);
  looked.push(`Claude transcripts of the last ${DAYS} days (${files.length} file${files.length === 1 ? "" : "s"} in ${dirs.length ? dirs.join(", ") : path.join(homeOf(env), ".claude", "projects", mangle(path.resolve(cwd)))})`);
  const t0 = Date.now(); let scanned = 0, limited = false;
  for (const f of files) {
    if (scanned > SCAN_BUDGET_BYTES || Date.now() - t0 > SCAN_BUDGET_MS) { limited = true; break; }
    const mine = [];
    try {
      const r = scanLines(f.p, 0, Infinity, (line) => {
        if (line.length > 4 * 1024 * 1024) return false;
        const s = line.toString("utf8"); if (!hasAll(s, words)) return false; // cheap test on the raw line first
        const x = textOfLine(s); if (x && hasAll(x.text, words)) { mine.push({ time: x.time || f.mtime, where: `transcript (${x.who})`, file: f.p, snip: snippet(x.text, words) }); if (mine.length > PER_FILE) mine.shift(); }
        return false;
      });
      scanned += r.size;
    } catch (e) { ignore(e); }
    hits.push(...mine);
  }
  hits.sort((a, b) => b.time - a.time);
  const shown = []; let used = 0; const note = (n) => `\n(+${n} more hit${n === 1 ? "" : "s"} not shown; narrow the words)`;
  const total = hits.length, cappedHits = hits.slice(0, maxHits);
  for (const h of cappedHits) {
    const block = `[${day(h.time)}] ${h.where}\n  "${h.snip}"\n  file: ${String(h.file).replace(/\\/g, "/")}`;
    if (used + block.length + 1 > maxBytes - 80) break; shown.push(block); used += block.length + 1;
  }
  let text;
  if (!total) text = `nothing found for "${words.join(" ")}". Looked in: ${looked.join("; ")}.${limited ? " (the scan stopped early on a large history; try more specific words)" : ""}`;
  else text = shown.join("\n") + (total > shown.length ? note(total - shown.length) : "") + (limited ? "\n(scan stopped early on a large history)" : "");
  if (Buffer.byteLength(text) > maxBytes) text = Buffer.from(text).subarray(0, maxBytes - 4).toString("utf8").replace(/�$/, "") + " …";
  return { text, total, shown: shown.length };
}
