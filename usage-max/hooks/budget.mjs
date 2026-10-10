#!/usr/bin/env node
// Budget governor hooks (one entry point, dispatched on hook_event_name). Fail-open everywhere:
// a governor bug must never block work, so every path exits 0 unless it deliberately decides.
//   Stop / SubagentStop   meter this session's spend, re-evaluate mode, enforce on change
//   UserPromptSubmit      once per session per mode: budget directive for Claude + notice for you
//   PreToolUse (Agent)    amber/red: downgrade Opus/Fable or inheriting subagents to Sonnet; always cap Fable
//   PreModelSwitch        block switches above Opus 5.5; in red, ask before switching to Opus
import { loadMeter, saveMeter, sessionFiles, meterFiles } from "../scripts/meter.mjs";
import { evaluate, loadState, saveState, loadConfig } from "../scripts/governor.mjs";

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let d = "";
  for await (const c of process.stdin) d += c;
  return d;
}
const out = (o) => process.stdout.write(JSON.stringify(o));
const pct = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "?" : `${Math.round(n)}%`);
const INHERITING = new Set(["general-purpose", "Plan", "claude", "fork", ""]);

function aboveCeiling(model) {
  const n = String(model || "").toLowerCase();
  if (n.includes("fable")) return true;
  const m = n.match(/opus-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 10 : 0) > 5.5 : false;
}

function directive(state) {
  const l = state.last || {};
  const head = `usage-max budget ${state.mode.toUpperCase()}: weekly plan ~${pct(l.estPct)} used, ${l.hoursLeft ? Math.round(l.hoursLeft) : "?"}h to reset, burning ${l.ratio ? l.ratio.toFixed(1) : "?"}x the sustainable rate.`;
  if (state.mode === "amber") {
    return `${head} Work economically so the week lasts: delegate searches/reads to usage-max-scout and routine edits/tests to usage-max-worker; read only the files you need, once; keep replies short; no speculative exploration or extra verification passes beyond the cheapest check.`;
  }
  return `${head} Conserve hard: finish the current task in as few turns as possible; delegate all searching/reading to usage-max-scout (Haiku); no new broad exploration, multi-agent fan-outs or optional refactors; keep replies to essentials. If the user asks for something large, say it is budget mode RED and offer a smaller first step.`;
}

try {
  const raw = await readStdin();
  let input = {};
  try { input = raw ? JSON.parse(raw) : {}; } catch { input = {}; }
  const event = input.hook_event_name || process.argv[2] || "";

  if (event === "Stop" || event === "SubagentStop") {
    const meter = loadMeter();
    meterFiles(meter, sessionFiles(input.transcript_path));
    saveMeter(meter);
    const before = loadState().mode;
    const state = evaluate({ meter });
    if (state.mode !== before && event === "Stop") {
      out({ systemMessage: `usage-max: budget mode ${before.toUpperCase()} → ${state.mode.toUpperCase()} (week ~${pct(state.last.estPct)}, ${state.last.ratio ? state.last.ratio.toFixed(1) : "?"}x sustainable burn). New sessions will start on ${loadConfig().modes[state.mode].model} @ ${loadConfig().modes[state.mode].effort}.` });
    }
  } else if (event === "UserPromptSubmit") {
    const state = loadState();
    if (state.mode !== "green") {
      const sid = input.session_id || "unknown";
      if (state.sessionsNotified[sid] !== state.mode) {
        state.sessionsNotified[sid] = state.mode;
        saveState(state);
        out({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: directive(state) }, systemMessage: `usage-max: budget ${state.mode.toUpperCase()} — week ~${pct(state.last && state.last.estPct)}; Claude has been told to work economically. /usage-max:budget for details.` });
      }
    }
  } else if (event === "PreToolUse" && (input.tool_name === "Agent" || input.tool_name === "Task")) {
    const ti = input.tool_input || {};
    const state = loadState();
    const requested = String(ti.model || "").toLowerCase();
    let next = null;
    if (requested === "fable" || aboveCeiling(requested)) next = state.mode === "green" ? "opus" : "sonnet";
    else if (state.mode !== "green" && (requested === "opus" || requested.includes("opus") || (!requested && INHERITING.has(String(ti.subagent_type || ""))))) next = "sonnet";
    if (next && next !== requested) {
      out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: `usage-max: ${requested || "inherited"} -> ${next} (budget ${state.mode})`, updatedInput: { ...ti, model: next }, additionalContext: `usage-max ran this subagent on ${next} instead of ${requested || "the session model"} (budget ${state.mode}).` } });
    }
  } else if (event === "PreModelSwitch") {
    const to = String(input.to_model || "");
    const state = loadState();
    if (aboveCeiling(to)) {
      out({ hookSpecificOutput: { hookEventName: "PreModelSwitch", permissionDecision: "deny", permissionDecisionReason: `usage-max: ${to} is above the Opus 5.5 ceiling.` } });
    } else if (state.mode === "red" && /opus/i.test(to)) {
      out({ hookSpecificOutput: { hookEventName: "PreModelSwitch", permissionDecision: "ask", permissionDecisionReason: `usage-max: budget RED (week ~${pct(state.last && state.last.estPct)}). Switching to ${to} costs ~2x Sonnet output and re-reads this whole conversation uncached. Continue?` } });
    }
  }
  process.exitCode = 0;
} catch {
  process.exitCode = 0;
}
