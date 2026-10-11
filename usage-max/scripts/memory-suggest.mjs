// `usage-max memory suggest`: finds candidate facts in a repo's OWN docs (rules, commands) and lists them with their source.
// It never saves anything by itself. `--accept 1,3` saves only the numbers you pick, each with its source file:line, so a first set of notes does not have to be written by hand
// and nothing is ever added that you did not approve. Deterministic text scan: no model, no network. Dependency-light (memory.mjs only).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { addFact, decide, looksSecret, stateDir, LIMITS } from "./memory.mjs";

const SKIP_DIRS = new Set([".git", "node_modules", ".memory", ".codex-tasks", "vendor", "target", "dist", "build", ".venv", "__pycache__", ".next"]);
const DOC = /\.(md|markdown|txt)$/i;
// an instruction, not a description: it starts like one, or it says must / required / source of truth. ("is never printed" describes; "Never print it" instructs.)
const START = /^(?:you |please )?(?:do not|don't|never|always|must|make sure|read|run|use|keep|regenerate|check|update|commit|push)\b/i;
const MUST = /\b(must not|must|required|source of truth|forbidden|not allowed)\b/i;
const isRule = (t) => /^[A-Z]/.test(t) && !/[:;,]$/.test(t) && (START.test(t) || MUST.test(t));
const HEAD_CMD = /(test|build|run|install|verify|lint|setup|start|check|deploy|release)/i;
const CMD = /^(\$\s*)?((?:\.\/|npm |npx |pnpm |yarn |cargo |go |python3? |pip3? |pytest|make\b|bash |sh |node |dotnet |mvn |gradle |docker |git |uv |poetry |rustup |just )[^\n]*)$/;
export const MAX_PER_FILE = 5, MAX_TOTAL = 25, MAX_TEXT = 200;

// dated session records and numbered handoffs are history; orientation docs rank first
export function fileRank(rel) {
  const base = path.basename(rel).toLowerCase(); let r = 0;
  if (/^(claude|agents|readme|contributing|source_of_truth|start_here|00_start_here|new_chat_start_here|architecture|development)/.test(base)) r += 5;
  if (/^(docs?|documentation)\//i.test(rel)) r += 1;
  if (/\d{4}-\d{2}-\d{2}/.test(base) || /^\d{2}[a-z]?_/.test(base)) r -= 3;
  return r - (rel.split("/").length - 1);
}
function* walk(root, dir = root, depth = 0) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && depth < 2) yield* walk(root, p, depth + 1); }
    else if (e.isFile() && DOC.test(e.name)) yield p;
  }
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).slice(0, 5).join("-");
const plain = (l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\*\*|__|`/g, "").trim();

export function suggest(root, { maxTotal = MAX_TOTAL } = {}) {
  const files = [...walk(root)].map((abs) => ({ abs, rel: path.relative(root, abs).replace(/\\/g, "/") })).map((f) => ({ ...f, rank: fileRank(f.rel) })).sort((a, b) => b.rank - a.rank || a.rel.localeCompare(b.rel)).slice(0, 14);
  const out = [], seen = new Set();
  for (const f of files) {
    let text; try { const st = fs.statSync(f.abs); if (st.size > 200000) continue; text = fs.readFileSync(f.abs, "utf8"); } catch { continue; }
    let fenced = false, heading = "", perFile = 0, group = [], groupAt = 0, groupHead = "";
    const flush = () => {
      if (!group.length || perFile >= MAX_PER_FILE) { group = []; return; }
      const keep = []; for (const c of group) if (`${groupHead}: ${[...keep, c].join("; ")}`.length <= MAX_TEXT) keep.push(c);
      if (keep.length) push({ kind: "topic", topic: "build-and-test", text: `${groupHead}: ${keep.join("; ")}`, score: 6 }, groupAt);
      group = [];
    };
    const push = (cand, at) => {
      if (looksSecret(cand.text) || cand.text.length > MAX_TEXT) return;
      const k = cand.text.toLowerCase().replace(/[^a-z0-9]+/g, ""); if (seen.has(k)) return; seen.add(k);
      out.push({ ...cand, source: `${f.rel}:${at}`, score: cand.score + f.rank * 2 }); perFile++;
    };
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && perFile < MAX_PER_FILE; i++) {
      const line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) { if (fenced) flush(); fenced = !fenced; continue; }
      const h = line.match(/^#{1,4}\s+(.*)$/); if (!fenced && h) { flush(); heading = plain(h[1]); continue; }
      if (/^\s*\|/.test(line) || /removed|TODO|FIXME/.test(line)) continue;
      if (fenced) {
        const m = line.trim().match(CMD);
        if (m && HEAD_CMD.test(heading)) { const c = m[2].replace(/\s+#.*$/, "").trim(); if (c) { if (!group.length) { groupAt = i + 1; groupHead = heading; } group.push(c); } }
      } else {
        for (const sent of plain(line).split(/(?<=[.!?])\s+/)) {
          if (sent.length < 25 || sent.length > MAX_TEXT || !isRule(sent.trim())) continue; // too long = skipped, never cut
          const cues = (sent.match(new RegExp(MUST.source, "gi")) || []).length + (START.test(sent.trim()) ? 1 : 0);
          push({ kind: "decision", key: slug(sent), text: sent.trim(), score: 4 + cues }, i + 1); break;
        }
      }
    }
    flush();
  }
  return out.sort((a, b) => b.score - a.score).slice(0, maxTotal).map((c, i) => ({ id: i + 1, ...c }));
}
export const stateFile = (root, env = process.env) => path.join(stateDir(env), `suggest-${crypto.createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 12)}.json`);
export function saveCandidates(root, list, env) { try { const f = stateFile(root, env); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), list })); } catch {} }
export function loadCandidates(root, env) { try { return JSON.parse(fs.readFileSync(stateFile(root, env), "utf8")).list || null; } catch { return null; } }
export function render(list) {
  if (!list.length) return "no candidate rules or commands found in this repo's docs. Add notes yourself: usage-max memory decide <key> <value>";
  return list.map((c) => `${String(c.id).padStart(2)}. [${c.kind === "topic" ? "note:" + c.topic : "decision"}] ${c.text}\n      source: ${c.source}`).join("\n")
    + "\n\nNothing has been saved. Save the ones that are true and useful: usage-max memory suggest --accept 1,3,5   (each is saved with its source)";
}
// ids: array of numbers. Returns { saved: [...], skipped: [...] }
export function accept(mem, list, ids) {
  const saved = [], skipped = [];
  for (const id of ids) {
    const c = (list || []).find((x) => x.id === id); if (!c) { skipped.push(`#${id}: no such candidate (run suggest again)`); continue; }
    const suffix = ` (source: ${c.source})`;
    const r = c.kind === "topic" ? addFact(mem, c.topic, c.text + suffix) : decide(mem, c.key, c.text + suffix);
    if (r.error) skipped.push(`#${id}: ${r.error}`); else saved.push(`#${id}: ${r.unchanged || r.duplicate ? "already there" : c.kind === "topic" ? "noted in " + c.topic : "decided " + c.key}`);
  }
  return { saved, skipped };
}
