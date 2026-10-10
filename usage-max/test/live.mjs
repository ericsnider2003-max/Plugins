#!/usr/bin/env node
// LIVE verification (spends a small amount of real usage). Requires `claude` logged in.
// Checks: hub runs on the settings model (Opus 5.5) at the configured effort, subagents route to
// Haiku/Sonnet, hooks fire, the ledger attributes subagent tool calls to the subagent's model.
// Usage: node test/live.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const work = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-live-"));
const debug = path.join(work, "hook-debug.jsonl");
const ledger = path.join(home, ".claude", "usage-max", "ledger.jsonl");
fs.writeFileSync(path.join(work, "sample.txt"), "hello usage-max\n");
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

function run(prompt, extra = []) {
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-hook-events", "--max-turns", "12", ...extra];
  const r = spawnSync("claude", args.map((a) => (process.platform === "win32" && /\s/.test(a) ? `"${a}"` : a)), {
    cwd: work, encoding: "utf8", shell: process.platform === "win32", input: "",
    env: { ...process.env, USAGE_MAX_HOOK_DEBUG: debug }, maxBuffer: 64 * 1024 * 1024, timeout: 600000
  });
  const events = String(r.stdout || "").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { events, stderr: r.stderr, result: events.find((e) => e.type === "result") };
}

const auth = spawnSync("claude", ["auth", "status"], { encoding: "utf8", shell: process.platform === "win32" });
if (!/"loggedIn":\s*true/.test(auth.stdout || "")) {
  console.log("BLOCKED: claude is not logged in. Run `claude` then `/login`, and re-run this script.");
  process.exit(3);
}
const ledgerStart = fs.existsSync(ledger) ? fs.statSync(ledger).size : 0;

// 1) Hub model from settings (no --model flag).
const a = run("Reply with exactly: ok");
const hubModels = Object.keys((a.result && a.result.modelUsage) || {});
check("hub runs on claude-opus-5-5 from settings", hubModels.length === 1 && hubModels[0] === "claude-opus-5-5", hubModels.join(",") || (a.result && a.result.result) || a.stderr.slice(0, 200));
const init = a.events.find((e) => e.type === "system" && e.subtype === "init");
check("init reports model", Boolean(init && init.model), init ? `model=${init.model}` : "no init");
const ss = a.events.find((e) => e.subtype === "hook_response" && e.hook_event === "SessionStart" && /usage-max/.test(e.output || ""));
check("SessionStart marker: profile enforced", Boolean(ss && /profile=enforced/.test(ss.output)), ss ? ss.output.trim() : "no marker");

// 2) Routing: scout (Haiku) + worker (Sonnet) from an Opus 5.5 hub.
const b = run("Use the usage-max:usage-max-scout subagent to read sample.txt and report its contents. Then use the usage-max:usage-max-worker subagent to run the shell command `node -e \"console.log(1+1)\"` and report the output. Do not do either task yourself.",
  ["--allowedTools", "Bash(node:*)"]);
const usage = (b.result && b.result.modelUsage) || {};
check("scout ran on Haiku", Boolean(usage["claude-haiku-5-5"]), Object.keys(usage).join(","));
check("worker ran on Sonnet 5.5", Boolean(usage["claude-sonnet-5-5"]), Object.keys(usage).join(","));
check("nothing above Opus 5.5", !Object.keys(usage).some((m) => /fable|opus-(?:[6-9]|5-[6-9])/.test(m)), Object.keys(usage).join(","));
const subTools = b.events.filter((e) => e.type === "assistant" && e.parent_tool_use_id).map((e) => e.message.model);
check("subagent turns observed", subTools.length > 0, [...new Set(subTools)].join(","));

// 3) Hook input shape + ledger attribution.
const raws = fs.existsSync(debug) ? fs.readFileSync(debug, "utf8").split(/\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
const post = raws.filter((r) => r.hook === "PostToolUse").map((r) => { try { return JSON.parse(r.raw); } catch { return {}; } });
const ssIn = raws.filter((r) => r.hook === "SessionStart").map((r) => { try { return JSON.parse(r.raw); } catch { return {}; } });
console.log(`info SessionStart input keys: ${[...new Set(ssIn.flatMap(Object.keys))].join(",")}`);
console.log(`info PostToolUse input keys: ${[...new Set(post.flatMap(Object.keys))].join(",")}`);
const subPost = post.filter((p) => p.agent_id || p.agent_type || p.agent_transcript_path);
check("PostToolUse identifies subagent calls", subPost.length > 0, `${subPost.length} of ${post.length} carried agent_id/agent_type`);
const newLedger = fs.existsSync(ledger) ? fs.readFileSync(ledger, "utf8").slice(ledgerStart).split(/\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
const subRows = newLedger.filter((r) => r.scope === "subagent");
check("ledger: subagent rows carry Haiku/Sonnet, never the hub model", subRows.length > 0 && subRows.every((r) => r.model && /haiku|sonnet/.test(r.model)), subRows.map((r) => `${r.tool}:${r.model}`).join(" "));
check("ledger: hub rows carry Opus 5.5", newLedger.filter((r) => r.scope === "hub").every((r) => r.model === "claude-opus-5-5"), newLedger.filter((r) => r.scope === "hub").map((r) => `${r.tool}:${r.model}`).join(" "));

console.log(`\nworkdir: ${work}`);
console.log(failures ? `${failures} live check(s) failed` : "All live checks passed");
process.exit(failures ? 1 : 0);
