#!/usr/bin/env node
// Project memory + automatic resume point (see scripts/memory.mjs, scripts/resume.mjs). Fail-open: any error exits 0 silently. Does nothing inside Codex
// (Codex has its own hook, codex/scripts/codex-hook.mjs). Every output here is free text added to the model's context, kept short and capped.
//   SessionStart      memory block (decisions + topic list) and, for a fresh/cleared session, the last resume point of this folder
//   UserPromptSubmit  "remember: ..." is saved without a model call; notes whose topic the prompt mentions are added (once per session each)
//   PreCompact        save the resume point right before older detail is summarised away; SessionStart(compact) shows it again
//   Stop              save the resume point (throttled to once a minute; no model tokens)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir, readJson } from "../scripts/meter.mjs";
import { underCodex } from "../scripts/host.mjs";
import * as M from "../scripts/memory.mjs";
import * as R from "../scripts/resume.mjs";

async function readStdin() { if (process.stdin.isTTY) return ""; let d = ""; for await (const c of process.stdin) d += c; return d; }
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ctx = (ev, text, msg) => process.stdout.write(JSON.stringify({ ...(text ? { hookSpecificOutput: { hookEventName: ev, additionalContext: text } } : {}), ...(msg ? { systemMessage: msg } : {}) }));
try {
  let input = {}; try { const raw = await readStdin(); input = raw ? JSON.parse(raw) : {}; } catch {}
  if (underCodex(input)) process.exit(0);
  const dir = dataDir(), cwd = input.cwd || process.cwd(), sid = input.session_id || "unknown", ev = input.hook_event_name || process.argv[2] || "";
  const cfg = readJson(path.join(dir, "config.json"), {}) || {};
  const mem = cfg.memory === "off" ? null : M.findMemoryDir(cwd);
  const cmd = `node "${path.join(root, "scripts", "usage-max.mjs")}" memory`;
  if (ev === "SessionStart") {
    const parts = []; M.saveSeen(sid, new Set()); // new/cleared/compacted context: notes may be injected again
    if (mem) parts.push(M.fenceNotes(M.loadBlock(mem, { cap: Number(cfg.memoryBudgetChars) || 2500, cmd })));
    if (input.source === "compact") { // a compaction summarises older detail away: bring back the notes, the files being edited and the way to the full text
      const tp = input.transcript_path ? String(input.transcript_path).replace(/\\/g, "/") : null;
      const p = cfg.resume === "off" ? null : R.peekResume(R.sharedDir(), cwd, { mustInclude: tp });
      const tail = "\n(Context was just compacted. Anything the summary left out can be found in the full conversation file named above; check it before asking the user to repeat themselves.)";
      if (p) parts.push(M.fenceNotes(p, "resume-note") + tail); else if (tp) parts.push(`Full earlier conversation, word for word: ${tp} - search it (grep) for any detail before asking the user to repeat something.` + tail);
    }
    if (!input.source || input.source === "startup" || input.source === "clear") {
      const r = cfg.resume === "off" ? null : R.takeResume(R.sharedDir(), cwd, { tool: "claude" }); if (r) parts.push(M.fenceNotes(r, "resume-note") + "\n(Automatic note about the previous session in this folder; it may be stale. Ignore it if the user's request is about something else.)");
    }
    if (parts.length) ctx(ev, parts.join("\n\n"));
  } else if (ev === "UserPromptSubmit" && mem) {
    const prompt = String(input.prompt || ""); let msg = null;
    const dir0 = M.extractDirective(prompt);
    if (dir0) { const r = M.decide(mem, M.directiveKey(dir0), dir0); if (r.error) msg = `usage-max: not saved to project memory. ${r.error}`; else if (!r.unchanged) msg = "usage-max: saved to project memory (.memory/decisions.md)."; }
    const seen = M.loadSeen(sid); const r = M.recall(mem, prompt, { seen });
    if (r.text) { for (const k of r.keys) seen.add(k); M.saveSeen(sid, seen); }
    if (r.text || msg) ctx(ev, M.fenceNotes(r.text), msg);
  } else if (ev === "PreCompact" && cfg.resume !== "off") {
    R.saveResume(R.sharedDir(), cwd, R.buildResume({ transcript: input.transcript_path, cwd, tool: "claude" }), { minGapMs: 0 }); // snapshot right before detail is summarised away
  } else if (ev === "Stop" && cfg.resume !== "off") {
    R.saveResume(R.sharedDir(), cwd, R.buildResume({ transcript: input.transcript_path, cwd, tool: "claude" }));
  }
  process.exitCode = 0;
} catch { process.exitCode = 0; }
