#!/usr/bin/env node
// Codex hooks dispatcher: node codex-hook.mjs <SessionStart|UserPromptSubmit|Stop|PreToolUse>. Fail-open (always exit 0).
//  SessionStart     -> meter + evaluate; plain stdout = context (budget directive when AMBER/RED)
//  UserPromptSubmit -> once per session per mode: directive context in AMBER/RED
//  Stop             -> re-evaluate; on mode change apply profile + systemMessage
//  PreToolUse Bash  -> trim noisy simple commands via updatedInput (POSIX shells only; USAGE_MAX_TRIM=off disables)
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { evaluate, applyMode, dataDir, modeKey } from "./codex-governor.mjs";
import { readOther, balanceAdvice } from "./shared.mjs";
const NOISY = /^(npm|pnpm|yarn) (install|ci|i|test|run (test|build|lint))\b|^(pip3?|uv pip|poetry) install\b|^(pytest|python3? -m pytest|go test|cargo (test|build|check)|dotnet (test|build)|mvn |gradle |docker build|npx (jest|vitest|tsc|eslint)|tsc\b|make\b)/;
export function rewrite(cmd, trimPath, platform = process.platform) {
  if (typeof cmd !== "string" || process.env.USAGE_MAX_TRIM === "off") return null;
  if (platform === "win32" && process.env.USAGE_MAX_TRIM !== "force") return null;
  const c = cmd.trim(); if (!NOISY.test(c) || /[|><;&`$()]|\n/.test(c) || /--no-trim|--reporter|--json|-q\b|--quiet/.test(c)) return null;
  return `set -o pipefail; ${c} 2>&1 | node "${trimPath.replace(/\\/g, "/")}"`;
}
const DIRECTIVE = { amber: "usage-max AMBER: weekly budget is being burned faster than sustainable. Use low reasoning effort, keep scope tight, avoid re-reading files, no large autonomous jobs without asking.", red: "usage-max RED: weekly budget is nearly exhausted for the time left. Cheapest path only: minimal reads, no exploratory work, no fast mode, no long autonomous runs; ask before anything big." };
function seen(ev) { try { const f = path.join(dataDir(), "hook-seen.json"); let o = {}; try { o = JSON.parse(fs.readFileSync(f, "utf8")); } catch {} o[ev] = new Date().toISOString(); fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); } catch {} }
function userHooksInstalled() { try { return fs.readFileSync(path.join(codexHome(), "hooks.json"), "utf8").includes("codex-hook.mjs"); } catch { return false; } }
function main() {
  if (process.env.PLUGIN_ROOT && userHooksInstalled()) return; // loaded as a plugin AND installed user-wide: the user-wide copy handles it
  const ev = process.argv[2]; let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
  seen(ev);
  if (ev === "PreToolUse") {
    if (input.tool_name !== "Bash" || !input.tool_input) return;
    const nc = rewrite(input.tool_input.command, path.join(path.dirname(fileURLToPath(import.meta.url)), "trim.mjs"));
    if (nc) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input.tool_input, command: nc } } }));
    return;
  }
  const sf = path.join(dataDir(), "hook-state.json"); let st = {}; try { st = JSON.parse(fs.readFileSync(sf, "utf8")); } catch {}
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), "governor.json"), "utf8")); } catch { return {}; } })();
  const before = prev.mode || "green", beforeKey = prev.appliedKey || modeKey(before, prev.surplus);
  const { mode, surplus, cfg, st: gs, e: ge } = evaluate(); const key = modeKey(mode, surplus); if (key !== beforeKey) { try { applyMode(mode, cfg, surplus); } catch {} }
  const sid = input.session_id || "?"; st.sent = st.sent || {};
  if (ev === "SessionStart" || ev === "UserPromptSubmit") {
    const k = `${sid}:${key}`;
    if (!st.sent[k]) {
      const plan = ev === "SessionStart" && gs.calib && gs.calib.source === "plan" && ge ? `usage-max plan: weekly ${Math.round(ge.est)}% used, ${Math.round(ge.hoursLeft)}h to reset${gs.five ? `, 5h window ${Math.round(gs.five.pct)}%` : ""}, mode ${mode.toUpperCase()}. ` : "";
      const text = plan + (DIRECTIVE[mode] || "") + (surplus && ev === "SessionStart" ? "usage-max: allowance is going unused this week — you may use higher reasoning effort for hard problems." : ""); if (text) { st.sent[k] = Date.now(); process.stdout.write(text); } else st.sent[k] = Date.now();
    }
    try { const adv = balanceAdvice({ mode }, readOther()); const ak = `${sid}:adv:${adv}`; if (adv && !st.sent[ak]) { st.sent[ak] = Date.now(); process.stdout.write((st.sent[k] ? "\n" : "") + adv); } } catch {}
    const keys = Object.keys(st.sent); if (keys.length > 200) for (const x of keys.slice(0, keys.length - 100)) delete st.sent[x];
    try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(sf, JSON.stringify(st)); } catch {}
  } else if (ev === "Stop" && key !== beforeKey) {
    process.stdout.write(JSON.stringify({ systemMessage: `usage-max: budget mode ${beforeKey.toUpperCase()} -> ${key.toUpperCase()}. New sessions use ${cfg.modes[surplus ? "surplus" : mode].model || "your model"} @ ${cfg.modes[surplus ? "surplus" : mode].effort}; use /model to change this one.` }));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { main(); } catch {} process.exit(0); }
