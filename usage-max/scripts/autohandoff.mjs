// Automatic handoff, no model call: build a resume file from the session transcript (recent requests, files touched, open todos, git state).
// Used when the cache has gone cold on a big context: instead of paying to re-read it, /clear and continue from this file.
import fs from "node:fs"; import path from "node:path"; import { spawnSync } from "node:child_process";
import { redact } from "./memory.mjs";
const txt = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x && x.type === "text").map((x) => x.text).join("\n") : "");
const clip = (s, n) => { s = String(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
const NOISE = /^<(system-reminder|command-|local-command|task-notification)|^\[Request interrupted|^Caveat:/;
export function summarize(transcriptPath, { maxPrompts = 5 } = {}) {
  let t; try { t = fs.readFileSync(transcriptPath, "utf8"); } catch { return null; }
  const prompts = [], files = new Map(), seenFiles = []; let todos = null, cwd = null, branch = null;
  for (const line of t.split("\n")) {
    if (!line.trim()) continue; let r; try { r = JSON.parse(line); } catch { continue; } cwd = r.cwd || cwd; branch = r.gitBranch || branch;
    const m = r.message; if (!m) continue;
    if (r.type === "user" && !r.isMeta) { const s = txt(m.content); if (s && !NOISE.test(s.trim())) prompts.push(clip(s, 400)); }
    if (r.type === "assistant" && Array.isArray(m.content)) for (const b of m.content) {
      if (b.type !== "tool_use" || !b.input) continue;
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name) && (b.input.file_path || b.input.notebook_path)) { const f = b.input.file_path || b.input.notebook_path; files.set(f, (files.get(f) || 0) + 1); }
      if (b.name === "TodoWrite" && Array.isArray(b.input.todos)) todos = b.input.todos;
    }
  }
  return { prompts: prompts.slice(-maxPrompts), files: [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25), todos: todos ? todos.filter((x) => x.status !== "completed").slice(0, 15) : [], cwd, branch };
}
function git(cwd, ...a) { try { const r = spawnSync("git", a, { cwd, encoding: "utf8", timeout: 4000 }); return r.status === 0 ? r.stdout.trim() : ""; } catch { return ""; } }
export function render(s, sid, { now = new Date() } = {}) {
  const g = s.cwd ? { st: git(s.cwd, "status", "--short").split("\n").slice(0, 20).join("\n"), log: git(s.cwd, "log", "--oneline", "-5") } : { st: "", log: "" };
  const L = [`# Auto handoff (${now.toISOString().slice(0, 16)}Z, session ${String(sid).slice(0, 8)})`, "", "Built from the transcript without a model call, so it lists WHAT happened, not why. Skim it, then continue.", "",
    `Folder: ${s.cwd || "?"}${s.branch ? `  Branch: ${s.branch}` : ""}`, "", "## Your last requests (oldest first)", ...s.prompts.map((p, i) => `${i + 1}. ${p}`)];
  if (s.todos.length) L.push("", "## Open todos", ...s.todos.map((x) => `- [${x.status === "in_progress" ? "~" : " "}] ${x.content || x.subject || ""}`));
  if (s.files.length) L.push("", "## Files changed in this session", ...s.files.map(([f, n]) => `- ${f}${n > 1 ? ` (${n} edits)` : ""}`));
  if (g.st) L.push("", "## git status", "```", g.st, "```"); if (g.log) L.push("", "## recent commits", "```", g.log, "```");
  L.push("", "## To continue", "Start a fresh session (/clear) and say: \"Continue from the handoff file at <this file's path>; check git status first.\"");
  return redact(L.join("\n")) + "\n"; // prompts and git output can contain pasted keys
}
export function write(dir, sid, transcriptPath, { now = new Date() } = {}) {
  const s = summarize(transcriptPath); if (!s || !s.prompts.length) return null;
  const d = path.join(dir, "handoffs"); fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${now.toISOString().slice(0, 10)}-${String(sid).replace(/[^\w-]/g, "").slice(0, 8)}.md`); fs.writeFileSync(f, render(s, sid, { now }));
  try { for (const x of fs.readdirSync(d)) { const p = path.join(d, x); if (Date.now() - fs.statSync(p).mtimeMs > 14 * 864e5) fs.unlinkSync(p); } } catch {}
  return f;
}
