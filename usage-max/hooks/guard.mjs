#!/usr/bin/env node
// Session guards entry point (see scripts/guard.mjs). Fail-open: any error exits 0 silently. Does nothing inside Codex.
//   SessionStart       reset read memory on a fresh/compacted context; once a day show the savings digest; warn about heavy CLAUDE.md files
//   UserPromptSubmit   stale-cache and big-context nudges (shown to you only: no model tokens)
//   Stop               record activity
//   PostToolUse        runaway-loop detection; subagent finished
//   PreToolUse (Read)  hint on re-reading an unchanged file / huge whole-file reads (never blocks or changes the read)
import os from "node:os";
import path from "node:path";
import { dataDir, readJson, writeJsonAtomic } from "../scripts/meter.mjs";
import { underCodex } from "../scripts/host.mjs";
import * as G from "../scripts/guard.mjs";
import { scan } from "../scripts/ctxfiles.mjs";

async function readStdin() { if (process.stdin.isTTY) return ""; let d = ""; for await (const c of process.stdin) d += c; return d; }
const out = (o) => process.stdout.write(JSON.stringify(o));
try {
  let input = {}; try { const raw = await readStdin(); input = raw ? JSON.parse(raw) : {}; } catch {}
  if (underCodex(input)) process.exit(0);
  const dir = dataDir(), home = process.env.USAGE_MAX_HOME || os.homedir(), sid = input.session_id || "unknown", ev = input.hook_event_name || process.argv[2] || "";
  if (ev === "SessionStart") {
    G.resetReads(dir, sid); G.touch(dir, sid);
    const parts = [];
    const f = path.join(dir, "digest-shown.json"), shown = readJson(f, {}) || {};
    if (!shown.at || Date.now() - Date.parse(shown.at) > 864e5) {
      const d = G.digest(dir); if (d.lines.length) parts.push(`usage-max since ${String(d.since).slice(0, 10)}:\n${d.lines.join("\n")}`);
      try { writeJsonAtomic(f, { at: new Date().toISOString() }); } catch {}
    }
    const c = scan({ home, cwd: input.cwd || process.cwd() });
    if (c.total > 8000) parts.push(`usage-max: CLAUDE.md/AGENTS.md files plus their imports weigh about ${c.total} tokens on every turn here. See what to trim: /usage-max context`);
    if (parts.length) out({ systemMessage: parts.join("\n") });
  } else if (ev === "UserPromptSubmit") {
    const msg = G.promptCheck(dir, sid, { ctx: G.lastContext(input.transcript_path), ttlMs: G.cacheTtlMs(home) });
    const cap = G.loadCap(dir), capMsg = cap ? G.capCheck(dir, sid, G.sessionCost(input.transcript_path), cap) : null;
    if (msg || capMsg) out({ systemMessage: [msg, capMsg].filter(Boolean).join("\n") });
  } else if (ev === "Stop") {
    G.touch(dir, sid);
  } else if (ev === "PostToolUse") {
    const tool = input.tool_name || "";
    if (tool === "Agent" || tool === "Task") G.agentEnd(dir, input.tool_use_id);
    const r = G.loopCheck(dir, sid, tool, input.tool_input) || (() => { const m = G.editPattern(dir, sid, tool, input.tool_input); return m ? { additionalContext: m } : null; })();
    if (r) out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: r.additionalContext }, ...(r.systemMessage ? { systemMessage: r.systemMessage } : {}) });
  } else if (ev === "PreToolUse" && input.tool_name === "Read") {
    const hint = G.readCheck(dir, sid, input.tool_input);
    if (hint) out({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: hint } });
  }
  process.exitCode = 0;
} catch { process.exitCode = 0; }
