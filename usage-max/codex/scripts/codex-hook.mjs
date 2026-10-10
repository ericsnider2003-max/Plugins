#!/usr/bin/env node
// Codex hooks dispatcher: node codex-hook.mjs <SessionStart|UserPromptSubmit|Stop|PreToolUse>. Fail-open (always exit 0).
//  SessionStart     -> meter + evaluate; plain stdout = context (budget directive when AMBER/RED)
//  UserPromptSubmit -> once per session per mode: directive context in AMBER/RED
//  Stop             -> re-evaluate; on mode change apply profile + systemMessage
//  PreToolUse Bash  -> trim noisy simple commands via updatedInput (POSIX shells only; USAGE_MAX_TRIM=off disables)
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { evaluate, applyMode, dataDir } from "./codex-governor.mjs";
const NOISY = /^(npm|pnpm|yarn) (install|ci|i|test|run (test|build|lint))\b|^(pip3?|uv pip|poetry) install\b|^(pytest|python3? -m pytest|go test|cargo (test|build|check)|dotnet (test|build)|mvn |gradle |docker build|npx (jest|vitest|tsc|eslint)|tsc\b|make\b)/;
export function rewrite(cmd, trimPath, platform = process.platform) {
  if (typeof cmd !== "string" || process.env.USAGE_MAX_TRIM === "off") return null;
  if (platform === "win32" && process.env.USAGE_MAX_TRIM !== "force") return null;
  const c = cmd.trim(); if (!NOISY.test(c) || /[|><;&`$()]|\n/.test(c) || /--no-trim|--reporter|--json|-q\b|--quiet/.test(c)) return null;
  return `set -o pipefail; ${c} 2>&1 | node "${trimPath.replace(/\\/g, "/")}"`;
}
const DIRECTIVE = { amber: "usage-max AMBER: weekly budget is being burned faster than sustainable. Use low reasoning effort, keep scope tight, avoid re-reading files, no large autonomous jobs without asking.", red: "usage-max RED: weekly budget is nearly exhausted for the time left. Cheapest path only: minimal reads, no exploratory work, no fast mode, no long autonomous runs; ask before anything big." };
function main() {
  const ev = process.argv[2]; let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
  if (ev === "PreToolUse") {
    if (input.tool_name !== "Bash" || !input.tool_input) return;
    const nc = rewrite(input.tool_input.command, path.join(path.dirname(fileURLToPath(import.meta.url)), "trim.mjs"));
    if (nc) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input.tool_input, command: nc } } }));
    return;
  }
  const sf = path.join(dataDir(), "hook-state.json"); let st = {}; try { st = JSON.parse(fs.readFileSync(sf, "utf8")); } catch {}
  const before = (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), "governor.json"), "utf8")).mode; } catch { return "green"; } })();
  const { mode, cfg } = evaluate(); if (mode !== before) { try { applyMode(mode, cfg); } catch {} }
  const sid = input.session_id || "?"; st.sent = st.sent || {};
  if (ev === "SessionStart" || ev === "UserPromptSubmit") {
    const k = `${sid}:${mode}`;
    if (DIRECTIVE[mode] && !st.sent[k]) { st.sent[k] = Date.now(); process.stdout.write(DIRECTIVE[mode]); }
    const keys = Object.keys(st.sent); if (keys.length > 200) for (const x of keys.slice(0, keys.length - 100)) delete st.sent[x];
    try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(sf, JSON.stringify(st)); } catch {}
  } else if (ev === "Stop" && mode !== before) {
    process.stdout.write(JSON.stringify({ systemMessage: `usage-max: budget mode ${before.toUpperCase()} -> ${mode.toUpperCase()}. New sessions use ${cfg.modes[mode].model} @ ${cfg.modes[mode].effort}; use /model to change this one.` }));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { main(); } catch {} process.exit(0); }
