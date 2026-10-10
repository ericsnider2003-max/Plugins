#!/usr/bin/env node
// Fail-open PostToolUse ledger: records dispatch/tool activity locally for usage-check.
// Never blocks the session; never throws.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aboveCeiling } from "../scripts/ceiling.mjs";
import { underCodex } from "../scripts/host.mjs";

function homeDir() {
  return process.env.USAGE_MAX_HOME || os.homedir();
}

function ledgerPath() {
  return process.env.USAGE_MAX_LEDGER_PATH || path.join(homeDir(), ".claude", "usage-max", "ledger.jsonl");
}

function maxBytes() {
  const value = Number(process.env.USAGE_MAX_LEDGER_MAX_BYTES || 5 * 1024 * 1024);
  return Number.isFinite(value) && value > 1024 ? value : 5 * 1024 * 1024;
}

function hash(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function detailFor(input) {
  const tool = input.tool_name || input.toolName || "unknown";
  const payload = input.tool_input || input.toolInput || {};
  if (tool === "Bash" && typeof payload.command === "string") {
    return { kind: "bash", command: payload.command.slice(0, 160), hash: hash(payload.command) };
  }
  if ((tool === "Edit" || tool === "Write") && typeof payload.file_path === "string") {
    return { kind: "file", tool, file: path.basename(payload.file_path), hash: hash(payload.file_path) };
  }
  return { kind: "tool", tool, keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12) : [] };
}

function rotateIfNeeded(file) {
  try {
    const size = fs.statSync(file).size;
    if (size < maxBytes()) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotated = `${file}.${stamp}`;
    fs.renameSync(file, rotated);
    const dir = path.dirname(file);
    const base = path.basename(file);
    const rotatedFiles = fs.readdirSync(dir).filter((name) => name.startsWith(`${base}.`)).sort();
    while (rotatedFiles.length > 5) {
      const oldest = rotatedFiles.shift();
      try {
        fs.unlinkSync(path.join(dir, oldest));
      } catch {
        break;
      }
    }
    return rotated;
  } catch {
    return null;
  }
}

// Hook input carries no model field; recover it from the tail of the session transcript.
function modelFromTranscript(file) {
  try {
    if (!file) return null;
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, 256 * 1024);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      const lines = buffer.toString("utf8").split("\n").reverse();
      for (const line of lines) {
        if (!line.includes('"assistant"')) continue;
        try {
          const record = JSON.parse(line);
          if (record.type === "assistant" && record.message && record.message.model && record.message.model !== "<synthetic>") return record.message.model;
        } catch {}
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
  return null;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

// Subagent tool calls: resolve the subagent's own transcript so the model is the subagent's, not the hub's.
// Claude Code stores them at <project>/<session_id>/subagents/agent-<agent_id>.jsonl.
function transcriptFor(input) {
  const main = input.transcript_path || input.transcriptPath || null;
  if (input.agent_transcript_path) return { file: input.agent_transcript_path, scope: "subagent" };
  const agentId = input.agent_id || input.agentId;
  if (agentId && main) {
    const sessionId = input.session_id || path.basename(main, ".jsonl");
    const id = String(agentId).startsWith("agent-") ? String(agentId) : `agent-${agentId}`;
    const candidate = path.join(path.dirname(main), sessionId, "subagents", `${id}.jsonl`);
    if (fs.existsSync(candidate)) return { file: candidate, scope: "subagent" };
    return { file: null, scope: "subagent" };
  }
  return { file: main, scope: "hub" };
}


function firstWarning(dir, key) {
  const file = path.join(dir, "ceiling-warned.json");
  let seen = {};
  try {
    seen = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  if (seen[key]) return false;
  seen[key] = new Date().toISOString();
  const keys = Object.keys(seen);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete seen[k];
  try {
    fs.writeFileSync(file, JSON.stringify(seen));
  } catch {}
  return true;
}

function debugCapture(raw, hook) {
  const target = process.env.USAGE_MAX_HOOK_DEBUG;
  if (!target) return;
  try {
    fs.appendFileSync(target, `${JSON.stringify({ hook, ts: new Date().toISOString(), raw })}\n`);
  } catch {}
}

try {
  const raw = await readStdin();
  debugCapture(raw, "PostToolUse");
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }
  if (underCodex(input)) process.exit(0);
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  rotateIfNeeded(file);
  const source = transcriptFor(input);
  const model = input.model || modelFromTranscript(source.file) || null;
  const session = input.session_id || input.sessionId || null;
  const record = {
    ts: new Date().toISOString(),
    tool: input.tool_name || input.toolName || "unknown",
    session,
    model,
    scope: source.scope,
    agent: input.agent_type || input.agent_id || null,
    detail: detailFor(input)
  };
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  if (model && aboveCeiling(model) && firstWarning(path.dirname(file), `${session}:${model}`)) {
    // Shown to the user in-session; catches /model switches and --model flags that SessionStart cannot see.
    console.log(JSON.stringify({ systemMessage: `usage-max: this session is running ${model}, ABOVE the Opus 5.5 ceiling. Switch with /model claude-opus-5-5.` }));
  }
  process.exitCode = 0;
} catch {
  process.exitCode = 0;
}
