#!/usr/bin/env node
// LIVE verification against the real `claude` CLI (spends roughly $0.25 of plan usage; Sonnet hub, few turns).
// Loads THIS checkout with --plugin-dir and redirects usage-max's state to a throwaway USAGE_MAX_HOME, so it never
// touches your real ~/.claude settings. Requires `claude` logged in.   Usage: node test/live.mjs
// Proves: (1) SessionStart self-configures and injects the routing rules, (2) the unified command is registered,
// (3) an Opus subagent request is rewritten to Sonnet and nothing above Sonnet is billed, (4) the Stop hook meters,
// (5) a PreToolUse command rewrite is honoured without permissionDecision "allow" (so trim never bypasses prompts).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-live-"));
const sandbox = path.join(work, "home");
fs.mkdirSync(path.join(work, "cwd"), { recursive: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const auth = spawnSync("claude", ["auth", "status"], { encoding: "utf8", shell: process.platform === "win32" });
if (!/"loggedIn":\s*true/.test(auth.stdout || "")) {
  console.log("BLOCKED: claude is not logged in. Run `claude` then `/login`, and re-run this script.");
  process.exit(3);
}

function run(prompt, { cwd = path.join(work, "cwd"), extra = [], env = {} } = {}) {
  const args = ["-p", prompt, "--plugin-dir", root, "--model", "claude-sonnet-5-5", "--max-turns", "6", "--output-format", "stream-json", "--verbose", "--include-hook-events", ...extra];
  const r = spawnSync("claude", args, { cwd, encoding: "utf8", shell: process.platform === "win32", input: "", env: { ...process.env, USAGE_MAX_HOME: sandbox, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 280000 });
  const events = String(r.stdout || "").split(/\r?\n/).filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { events, result: events.find((e) => e.type === "result") || {} };
}

// 1+2+4: session start, command registration, Stop metering
const a = run("Reply with exactly: ok");
const ss = a.events.find((e) => e.subtype === "hook_response" && e.hook_event === "SessionStart" && /usage-max/.test(e.output || ""));
check("SessionStart marker + routing rules", Boolean(ss && /usage-max rules:/.test(ss.output) && /ceiling=opus-5.5/.test(ss.output)), ss ? ss.output.slice(0, 90) : "no marker");
check("SessionStart configured the (sandbox) settings", fs.existsSync(path.join(sandbox, ".claude", "settings.json")) && /"promptCacheTtl"/.test(fs.readFileSync(path.join(sandbox, ".claude", "settings.json"), "utf8")));
const init = a.events.find((e) => e.subtype === "init") || {};
check("unified /usage-max command registered", (init.slash_commands || []).some((c) => /usage-max:usage-max$/.test(c)), (init.slash_commands || []).filter((c) => /usage-max/.test(c)).join(","));
check("Stop hook metered the session", fs.existsSync(path.join(sandbox, ".claude", "usage-max", "meter.json")));
check("nothing above Sonnet billed for a trivial turn", !Object.keys(a.result.modelUsage || {}).some((m) => /opus|fable/.test(m)), Object.keys(a.result.modelUsage || {}).join(","));

// 3: Opus subagent request becomes Sonnet
const b = run("Use the Agent tool exactly once with subagent_type general-purpose and model opus, prompt: reply with the single word pong. Then reply with the subagent's answer only.");
const hook = b.events.find((e) => e.subtype === "hook_response" && e.hook_event === "PreToolUse" && /usage-max/.test(e.output || ""));
check("PreToolUse rewrote the subagent model", Boolean(hook && /"model":"sonnet"/.test(hook.output)), hook ? "opus -> sonnet" : "no rewrite seen");
check("only Sonnet billed (no Opus subagent)", Object.keys(b.result.modelUsage || {}).every((m) => /sonnet/.test(m)), Object.keys(b.result.modelUsage || {}).join(","));

// 5: a rewrite without permissionDecision still applies (tiny throwaway plugin-less settings in the work dir)
const proj = path.join(work, "rewrite");
fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
fs.writeFileSync(path.join(proj, "rw.mjs"), 'import fs from "node:fs";const i=JSON.parse(fs.readFileSync(0,"utf8")||"{}");if(i.tool_name==="Bash"&&/echo ORIGINAL/.test(i.tool_input.command))process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",updatedInput:{...i.tool_input,command:"echo REWRITTEN"}}}));\n');
fs.writeFileSync(path.join(proj, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `node "${path.join(proj, "rw.mjs")}"` }] }] } }));
const c = run("Run exactly this bash command and reply with its output only: echo ORIGINAL", { cwd: proj, extra: ["--allowedTools", "Bash"] });
check("command rewrite works without permissionDecision allow", /REWRITTEN/.test(c.result.result || ""), JSON.stringify(c.result.result || "").slice(0, 60));

console.log(`\nworkdir: ${work}`);
console.log(failures ? `${failures} live check(s) failed` : "All live checks passed");
process.exit(failures ? 1 : 0);
