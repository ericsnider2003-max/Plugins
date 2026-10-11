#!/usr/bin/env node
// usage-max memory <init|add|decide|recall|index|lint|sync|export|import|status> ... (see scripts/memory.mjs)
import fs from "node:fs";
import path from "node:path";
import * as M from "./memory.mjs";

const [sub = "status", ...a] = process.argv.slice(2);
const flag = (n) => { const i = a.indexOf("--" + n); if (i < 0) return null; const v = a[i + 1]; a.splice(i, v && !v.startsWith("--") ? 2 : 1); return v && !v.startsWith("--") ? v : true; };
const bool = (n) => { const i = a.indexOf("--" + n); if (i < 0) return false; a.splice(i, 1); return true; };
const cwd = process.cwd();
const need = () => { const m = M.findMemoryDir(cwd); if (!m) { console.log("no project memory here yet. Create it: usage-max memory init   (makes .memory/ in this folder; commit it)"); process.exit(1); } return m; };
const rel = (m, f) => path.relative(cwd, f) || f;
if (sub === "init") {
  const had = M.findMemoryDir(cwd); const m = M.init(cwd);
  console.log(`${had ? "already set up" : "created"}: ${m}\nNext: usage-max memory decide [--pin] <key> <value>   |   usage-max memory add <topic> "<fact>"   |   usage-max memory sync   (puts the block in AGENTS.md for Codex cloud / mobile)`);
} else if (sub === "add") {
  const m = need(); const r = M.addFact(m, a[0], a.slice(1).join(" ")); console.log(r.error || (r.duplicate ? `already noted in ${r.topic}` : `noted in ${rel(m, r.file)}`)); process.exit(r.error ? 1 : 0);
} else if (sub === "decide") {
  const pin = bool("pin"); const m = need(); const r = M.decide(m, a[0], a.slice(1).join(" "), new Date(), { pin: Boolean(pin) }); console.log(r.error || (r.unchanged ? `unchanged: ${r.key}` : `decided: ${r.key}${r.replaced ? ` (was: ${r.replaced})` : ""}`)); process.exit(r.error ? 1 : 0);
} else if (sub === "recall") {
  const m = need(); const r = M.recall(m, a.join(" "), { max: 5, budget: 4000, loose: true }); console.log(r.text || "nothing in .memory/topics matches that."); 
} else if (sub === "index") { const m = need(); M.rebuildIndex(m); console.log(`rebuilt ${rel(m, path.join(m, "INDEX.md"))}`);
} else if (sub === "lint") {
  const m = need(); const p = M.lint(m); console.log(p.length ? p.map((x) => "- " + x).join("\n") : "memory is healthy."); process.exit(p.length ? 2 : 0);
} else if (sub === "sync") {
  const m = need(); const check = bool("check"); const root = M.repoRootOf(m);
  const fa = flag("files"); const files = (typeof fa === "string" ? fa.split(",").map((x) => x.trim()).filter(Boolean) : ["AGENTS.md"]).map((f) => path.join(root, f));
  if (check) { const stale = files.filter((f) => !M.syncCheck(m, f)); console.log(stale.length ? `stale: ${stale.map((f) => rel(m, f)).join(", ")} — run: usage-max memory sync` : "AGENTS.md block is current."); process.exit(stale.length ? 3 : 0); }
  let bad = 0; for (const f of files) { const r = M.syncFile(m, f); if (r.error) bad = 1; console.log(r.error ? `NOT updated: ${rel(m, f)} — ${r.error}` : `${r.changed ? "updated" : "already current"}: ${rel(m, f)}`); } if (bad) process.exit(1);
  console.log("Commit it: Codex cloud tasks (including from the mobile app) read AGENTS.md from the repo.");
} else if (sub === "export") { console.log(M.loadBlock(need(), { cap: 3000, cmd: "(ask the assistant to note it)" }));
} else if (sub === "import") {
  const m = need(); if (!a[0] || !fs.existsSync(a[0])) { console.log("usage: usage-max memory import <folder-with-.md-notes>   (an Obsidian vault works; files are copied, never changed)"); process.exit(1); }
  const r = M.importNotes(m, a[0]); console.log(`imported ${r.imported} note(s) into .memory/topics/ (${r.skipped} skipped: existing, too big or hidden). Review them, then: usage-max memory sync`);
} else {
  const m = M.findMemoryDir(cwd);
  if (!m) { console.log("project memory: not set up here. usage-max memory init"); process.exit(0); }
  const d = M.readDecisions(m), t = M.listTopics(m); const b = M.loadBlock(m, { cap: 1e9 }).length;
  console.log(`project memory: ${m}\n  ${d.length} decision(s), ${t.length} topic(s), always-loaded block ${b} chars (~${Math.round(b / 3.6)} tokens)\n  commands: init add decide recall index lint sync export import`);
}
