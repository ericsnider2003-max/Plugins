// Clean-room end-to-end test: what a brand-new user gets on a machine with no history, no settings and no prior state.
// Every command and hook is run for real in a throwaway home folder. Anything that crashes, prints garbage ("undefined", "NaN",
// "[object Object]", stack traces) or exits with an unexpected code fails the run. Windows-only paths cannot be tested here.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict";
import { spawnSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "um-e2e-"));
const baseEnv = { ...process.env, HOME: home, USERPROFILE: home, USAGE_MAX_HOME: home };
for (const k of ["CODEX_HOME", "CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT", "CLAUDECODE", "CLAUDE_CODE_REMOTE", "USAGE_MAX_HOST", "USAGE_MAX_OLLAMA"]) delete baseEnv[k];
const BAD = /\bundefined\b|\bNaN\b|\[object Object\]|TypeError|ReferenceError|SyntaxError|Cannot read prop|ENOENT: no such|at file:\/\/\/|node:internal/;
const failures = []; let n = 0;
const run = (file, args = [], { input = "", env = {}, ok = [0], label = null } = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, file), ...args], { input, env: { ...baseEnv, ...env }, encoding: "utf8", timeout: 60000 });
  const out = (r.stdout || "") + (r.stderr || ""); n++; const name = label || `${file} ${args.join(" ")}`.trim();
  if (!ok.includes(r.status)) failures.push(`${name}: exit ${r.status} (wanted ${ok.join("/")})\n    ${out.slice(0, 300).replace(/\n/g, "\n    ")}`);
  else if (BAD.test(out)) failures.push(`${name}: garbage in output -> ${(out.match(BAD) || [""])[0]}\n    ${out.slice(0, 300).replace(/\n/g, "\n    ")}`);
  return { ...r, out };
};
const jsonOrEmpty = (name, s) => { if (!s.trim()) return; try { JSON.parse(s); } catch { failures.push(`${name}: stdout is neither empty nor JSON: ${s.slice(0, 120)}`); } };

// ---- 1. Claude side, empty machine: every user-facing command must work and say something sensible
const U = "scripts/usage-max.mjs";
for (const sub of ["status", "", "doctor", "gate", "savings", "anomaly", "trim", "budgets", "cap", "offload status", "digest", "context", "balance", "chat-prefs", "diagnose", "audit", "check", "diet"]) {
  const args = sub ? sub.split(" ") : []; const r = run(U, args, { ok: sub === "gate" ? [0, 10, 20] : sub === "offload status" ? [0, 1] : sub === "doctor" ? [0, 1] : [0, 1], label: `usage-max ${sub || "(no args)"}` });
  if (!r.out.trim()) failures.push(`usage-max ${sub || "(no args)"}: printed nothing`);
}
// calibrate + status afterwards (the manual path used by the desktop app / cloud)
run(U, ["budget", "calibrate", "40", "--resets", new Date(Date.now() + 3 * 864e5).toISOString()]);
const st = run(U, ["status"]); if (!/GREEN|AMBER|RED/.test(st.out)) failures.push("status after calibrate shows no mode: " + st.out.slice(0, 200));
run(U, ["cap", "5"]); run(U, ["cap", "off"]); run(U, ["trim", "off"]); run(U, ["trim", "on"]);
run(U, ["enable-here", fs.mkdtempSync(path.join(os.tmpdir(), "um-repo-"))]);

// ---- 2. Claude hooks with realistic payloads: exit 0 and JSON-or-nothing on stdout
const sid = "e2e-claude-1", tr = path.join(home, "t.jsonl");
fs.writeFileSync(tr, JSON.stringify({ type: "user", cwd: home, message: { content: "hello" } }) + "\n" + JSON.stringify({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 100, cache_read_input_tokens: 90000 } } }) + "\n");
const base = { session_id: sid, transcript_path: tr, cwd: home };
const claudeHooks = [
  ["hooks/session-start.mjs", { ...base, hook_event_name: "SessionStart", source: "startup" }],
  ["hooks/budget.mjs", { ...base, hook_event_name: "UserPromptSubmit", prompt: "do the thing" }, ["UserPromptSubmit"]],
  ["hooks/budget.mjs", { ...base, hook_event_name: "Stop" }, ["Stop"]],
  ["hooks/budget.mjs", { ...base, hook_event_name: "SubagentStop" }, ["SubagentStop"]],
  ["hooks/budget.mjs", { ...base, hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "general-purpose", prompt: "x" } }, ["PreToolUse"]],
  ["hooks/budget.mjs", { ...base, hook_event_name: "PreModelSwitch", model: "claude-sonnet-5-5" }, ["PreModelSwitch"]],
  ["hooks/guard.mjs", { ...base, hook_event_name: "SessionStart" }],
  ["hooks/guard.mjs", { ...base, hook_event_name: "UserPromptSubmit", prompt: "x" }],
  ["hooks/guard.mjs", { ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } }],
  ["hooks/guard.mjs", { ...base, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "/x", old_string: "abc", new_string: "abd" } }],
  ["hooks/guard.mjs", { ...base, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: tr } }],
  ["hooks/guard.mjs", { ...base, hook_event_name: "Stop" }],
  ["hooks/ledger.mjs", { ...base, hook_event_name: "PostToolUse", tool_name: "Agent", tool_input: { subagent_type: "x" } }],
  ["hooks/bash-trim.mjs", { ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } }],
  ["hooks/bash-trim.mjs", { ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls -la | head" } }],
  ["hooks/cross-gate.mjs", { ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "codex exec --json hi" } }],
];
for (const [file, payload, extra] of claudeHooks) { const r = run(file, extra || [], { input: JSON.stringify(payload), env: { USAGE_MAX_HOST: "claude" }, label: `${file} ${payload.hook_event_name}` }); if (file !== "hooks/session-start.mjs") jsonOrEmpty(`${file} ${payload.hook_event_name}`, r.stdout || ""); }
// garbage / empty stdin must never crash a hook (they run on every action)
for (const f of ["hooks/session-start.mjs", "hooks/budget.mjs", "hooks/guard.mjs", "hooks/ledger.mjs", "hooks/bash-trim.mjs", "hooks/cross-gate.mjs"]) { run(f, ["Stop"], { input: "", env: { USAGE_MAX_HOST: "claude" }, label: `${f} empty stdin` }); run(f, ["Stop"], { input: "{not json", env: { USAGE_MAX_HOST: "claude" }, label: `${f} garbage stdin` }); }
// status line: a real-shaped payload must record plan percentages
const sl = run("scripts/statusline.mjs", [], { input: JSON.stringify({ model: { id: "claude-opus-5-5", display_name: "Opus" }, session_id: sid, transcript_path: tr, cwd: home, rate_limits: { five_hour: { used_percentage: 12, resets_at: Math.floor(Date.now() / 1000) + 3600 }, seven_day: { used_percentage: 41, resets_at: Math.floor(Date.now() / 1000) + 3 * 86400 } }, context_window: { used_percentage: 20 } }), label: "statusline.mjs" });
if (!sl.out.trim()) failures.push("statusline printed nothing");
const st2 = run(U, ["status"]); if (!/41|plan/i.test(st2.out)) failures.push("status does not reflect the status-line plan %: " + st2.out.slice(0, 200));

// ---- 3. Codex side on a machine that has never had usage-max
const ch = path.join(home, ".codex"); fs.mkdirSync(path.join(ch, "sessions", "2026", "10", "11"), { recursive: true }); fs.writeFileSync(path.join(ch, "config.toml"), 'model = "gpt-x"\n[projects."/p"]\ntrust_level = "trusted"\n');
const cenv = { CODEX_HOME: ch };
run("codex/scripts/install.mjs", [], { env: cenv, label: "codex install.mjs (fresh)" });
const cfg = fs.readFileSync(path.join(ch, "config.toml"), "utf8"); if (!/\[projects\."\/p"\]/.test(cfg) || !/model = "gpt-x"/.test(cfg)) failures.push("codex install damaged the user's config.toml:\n" + cfg);
if (!fs.existsSync(path.join(ch, "hooks.json"))) failures.push("codex install wrote no hooks.json"); else jsonOrEmpty("codex hooks.json", fs.readFileSync(path.join(ch, "hooks.json"), "utf8"));
const rl = (used, mins, reset) => ({ used_percent: used, window_minutes: mins, resets_at: Math.floor(reset / 1000) });
const roll = path.join(ch, "sessions", "2026", "10", "11", "rollout-2026-10-11T01-00-00-e2ecodex.jsonl"); const lines = [JSON.stringify({ type: "session_meta", payload: { cwd: home, source: "cli", model: "gpt-x" } }), JSON.stringify({ type: "turn_context", payload: { model: "gpt-x", effort: "medium" } })];
for (let i = 0; i < 30; i++) lines.push(JSON.stringify({ timestamp: new Date(Date.now() - (30 - i) * 60e3).toISOString(), type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 40000 + i * 3000, cached_input_tokens: 39000 + i * 3000, output_tokens: 300, reasoning_output_tokens: 100 } }, rate_limits: { primary: rl(5 + i, 300, Date.now() + 3 * 3600e3), secondary: rl(20 + i * 0.5, 10080, Date.now() + 4 * 864e5) } } }));
fs.writeFileSync(roll, lines.join("\n") + "\n");
const cg = "codex/scripts/codex-governor.mjs";
for (const sub of ["status", "doctor", "gate", "savings", "models", "profiles"]) { const r = run(cg, [sub], { env: cenv, ok: sub === "gate" ? [0, 10, 20] : [0, 1], label: `codex-governor ${sub}` }); if (!r.out.trim()) failures.push(`codex-governor ${sub}: printed nothing`); }
for (const f of ["codex-diagnose.mjs", "codex-weights.mjs"]) { const r = run("codex/scripts/" + f, [], { env: cenv, label: f }); if (!r.out.trim()) failures.push(f + ": printed nothing"); }
run(cg, ["selftest-trim"], { env: cenv, ok: [0, 1] }); run(cg, ["mode", "red"], { env: cenv }); run(cg, ["mode", "auto"], { env: cenv }); run(cg, ["backup"], { env: cenv });
const ccfg = fs.readFileSync(path.join(ch, "config.toml"), "utf8"); if (!/\[projects\."\/p"\]/.test(ccfg)) failures.push("codex mode switching removed the user's own config tables");
const chook = "codex/scripts/codex-hook.mjs"; const cbase = { session_id: "e2ecodex", cwd: home, turn_id: "t1" };
for (const ev of ["SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"]) { const payload = ev === "PreToolUse" ? { ...cbase, tool_name: "Bash", tool_input: { command: "npm test" }, hook_event_name: ev } : { ...cbase, hook_event_name: ev }; const r = run(chook, [ev], { input: JSON.stringify(payload), env: { ...cenv, PLUGIN_ROOT: "" }, label: `codex-hook ${ev}` });
  if (ev === "PreToolUse" || ev === "Stop") jsonOrEmpty("codex-hook " + ev, r.stdout || ""); }
for (const ev of ["SessionStart", "UserPromptSubmit", "PreToolUse", "Stop"]) { run(chook, [ev], { input: "", env: { ...cenv, PLUGIN_ROOT: "" }, label: `codex-hook ${ev} empty stdin` }); run(chook, [ev], { input: "{nope", env: { ...cenv, PLUGIN_ROOT: "" }, label: `codex-hook ${ev} garbage stdin` }); }
// Claude hooks running INSIDE Codex (Codex loads Claude-format plugins) must stay silent
for (const f of ["hooks/session-start.mjs", "hooks/budget.mjs", "hooks/guard.mjs", "hooks/bash-trim.mjs", "hooks/cross-gate.mjs"]) { const r = run(f, ["Stop"], { input: JSON.stringify({ ...cbase, hook_event_name: "Stop", tool_name: "Bash", tool_input: { command: "codex exec x" } }), env: { PLUGIN_ROOT: "/x" }, label: `${f} inside Codex` }); if ((r.stdout || "").trim()) failures.push(`${f} printed output inside Codex: ${r.stdout.slice(0, 100)}`); }

// ---- 4. Chat apps (no hooks possible): the text a user pastes must exist, be non-empty and fit the app's limits
const chat = fs.readFileSync(path.join(root, "chat-preferences.md"), "utf8"), gpt = fs.readFileSync(path.join(root, "codex/chatgpt/CUSTOM-INSTRUCTIONS.md"), "utf8");
if (chat.length < 200) failures.push("chat-preferences.md is empty"); if (BAD.test(chat) || BAD.test(gpt)) failures.push("chat text contains placeholder garbage");
const kit = path.join(root, "..", "install", "kit"); if (fs.existsSync(kit)) { const p = fs.readFileSync(path.join(kit, "5-PASTE-INTO-CHAT-SETTINGS.txt"), "utf8"); if (p.length < 200) failures.push("kit paste file is empty"); }

console.log(`${n} commands/hooks run in a clean room`);
if (failures.length) { console.error(`\n${failures.length} FAILURE(S):\n` + failures.map((f) => " - " + f).join("\n")); process.exit(1); }
console.log("clean-room end-to-end: all passing");
