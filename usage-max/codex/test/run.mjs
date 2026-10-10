import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict"; import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "umc-")); const env = { ...process.env, USAGE_MAX_HOME: home, CODEX_HOME: "" }; delete env.CODEX_HOME;
const g = (...a) => spawnSync("node", [path.join(root, "scripts/codex-governor.mjs"), ...a], { env, encoding: "utf8" });
let n = 0; const t = (name, f) => { f(); n++; console.log("ok -", name); };
const ch = path.join(home, ".codex"); const day = path.join(ch, "sessions/2026/10/07"); fs.mkdirSync(day, { recursive: true });
const now = Date.now(); const L = [];
L.push({ timestamp: new Date(now - 36e5).toISOString(), type: "turn_context", payload: { model: "gpt-6.1-sol" } });
for (let i = 0; i < 4; i++) L.push({ timestamp: new Date(now - 36e5 + i * 6e4).toISOString(), type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100000, cached_input_tokens: 80000, output_tokens: 4000 } } } });
fs.writeFileSync(path.join(day, "rollout-2026-10-07T00-00-00-abc.jsonl"), L.map(x => JSON.stringify(x)).join("\n") + "\n{partial");
fs.writeFileSync(path.join(ch, "config.toml"), 'approval_policy = "on-request"\nmodel = "old"\n\n[mcp_servers.x]\ncommand = "x"\n');
t("uncalibrated status works", () => { const r = g("status"); assert.equal(r.status, 0); assert.match(r.stdout, /not calibrated/); });
t("calibrate computes k and estimate", () => { const r = g("calibrate", "60", "--resets", new Date(now + 97 * 36e5).toISOString()); assert.match(r.stdout, /est plan 60/); });
t("meter counts spend with model weight", () => { const m = JSON.parse(fs.readFileSync(path.join(home, ".usage-max-codex/meter.json"))); const tot = Object.values(m.hours).reduce((a, b) => a + b, 0); assert.ok(Math.abs(tot - 20 * 4 * (20000 + 8000 + 20000) / 1e6) < 1e-9, String(tot)); });
t("partial trailing line not consumed twice", () => { g("status"); const m = JSON.parse(fs.readFileSync(path.join(home, ".usage-max-codex/meter.json"))); assert.equal(Object.values(m.hours).reduce((a, b) => a + b, 0) > 0, true); });
t("manual red -> config.toml top-level only, tables intact, backup", () => { const r = g("mode", "red"); assert.match(r.stdout, /RED/); const c = fs.readFileSync(path.join(ch, "config.toml"), "utf8"); assert.match(c, /^approval_policy = "on-request"/m); assert.match(c, /^model = "gpt-6-luna"/m); assert.match(c, /model_reasoning_effort = "low"/); assert.ok(c.indexOf("model_reasoning_effort") < c.indexOf("[mcp_servers.x]")); assert.match(c, /\[mcp_servers.x\]\ncommand = "x"/); assert.ok(fs.existsSync(path.join(ch, "config.toml.usage-max-backup"))); assert.doesNotMatch(c, /model = "old"/); });
t("profiles written", () => { for (const m of ["green", "amber", "red"]) assert.ok(fs.existsSync(path.join(ch, `usage-max-${m}.config.toml`))); });
t("gate exit codes", () => { assert.equal(g("gate").status, 20); g("mode", "green"); assert.equal(g("gate").status, 0); g("mode", "auto"); });
t("auto goes red when burning far above sustainable", () => { const r = g("status"); assert.match(r.stdout, /mode=(RED|AMBER)/); });
t("notify hook fail-open", () => { const r = spawnSync("node", [path.join(root, "scripts/notify.mjs"), "{}"], { env, encoding: "utf8" }); assert.equal(r.status, 0); });
t("installer idempotent, preserves notify", () => { fs.writeFileSync(path.join(ch, "AGENTS.md"), "# mine\n"); for (let i = 0; i < 2; i++) { const r = spawnSync("node", [path.join(root, "scripts/install.mjs")], { env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); } const a = fs.readFileSync(path.join(ch, "AGENTS.md"), "utf8"); assert.equal(a.split("usage-max:start").length, 2); assert.match(a, /# mine/); assert.match(fs.readFileSync(path.join(ch, "config.toml"), "utf8"), /^notify = \["node"/m); assert.ok(fs.existsSync(path.join(ch, "skills/usage-max/SKILL.md"))); });
t("existing foreign notify untouched", () => { const c = fs.readFileSync(path.join(ch, "config.toml"), "utf8").replace(/^notify = .*$/m, 'notify = ["foreign"]'); fs.writeFileSync(path.join(ch, "config.toml"), c); spawnSync("node", [path.join(root, "scripts/install.mjs")], { env }); assert.match(fs.readFileSync(path.join(ch, "config.toml"), "utf8"), /notify = \["foreign"\]/); });
console.log(`${n} passing`);
// codex-diet
{
  const { audit, apply } = await import(pathToFileURL(path.join(root, "scripts/codex-diet.mjs")).href);
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "umd-")); process.env.CODEX_HOME = h;
  fs.writeFileSync(path.join(h, "AGENTS.md"), "x".repeat(6000));
  fs.writeFileSync(path.join(h, "config.toml"), 'model = "m"\n\n[mcp_servers.gh]\ncommand = "gh-mcp"\n\n[mcp_servers.slack]\ncommand = "s"\nenabled_tools = ["post"]\ntimeout_seconds = 30\n');
  const r = audit({ cwd: h, home: h });
  t("codex-diet audits AGENTS.md/MCP/config", () => { assert.ok(r.advice.some((a) => a.action === "trim")); assert.ok(r.advice.some((a) => a.id === "gh" && a.action === "scope")); assert.ok(!r.advice.some((a) => a.id === "slack")); assert.ok(r.rows.some((x) => x.id === "slack")); assert.ok(r.advice.some((a) => /tool_output_token_limit/.test(a.why))); });
  t("codex-diet apply sets keys, disables MCP, keeps tables", () => { apply(h, ["gh"]); const c = fs.readFileSync(path.join(h, "config.toml"), "utf8"); assert.match(c, /^tool_output_token_limit = 8000/m); assert.match(c, /^compact_prompt = /m); assert.ok(c.indexOf("compact_prompt") < c.indexOf("[mcp_servers.gh]")); assert.match(c, /\[mcp_servers.gh\]\nenabled = false\ncommand/); assert.match(c, /enabled_tools = \["post"\]/); });
  delete process.env.CODEX_HOME;
}
console.log(`${n} passing (incl. diet)`);
// hooks + lean + models
{
  const hook = (ev, input, extra = {}) => spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), ev], { input: JSON.stringify(input), encoding: "utf8", env: { ...env, ...extra } });
  g("mode", "red");
  t("hook SessionStart injects RED directive once", () => { const a = hook("SessionStart", { session_id: "s1" }); assert.match(a.stdout, /usage-max RED/); assert.equal(hook("UserPromptSubmit", { session_id: "s1" }).stdout, ""); assert.match(hook("UserPromptSubmit", { session_id: "s2" }).stdout, /RED/); });
  g("mode", "green");
  t("hook Stop reports mode change; green silent start", () => { assert.equal(hook("SessionStart", { session_id: "s9" }).stdout, ""); });
  t("hook PreToolUse trims noisy bash (posix) / skips win32", () => { const o = JSON.parse(hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "pytest" } }, { USAGE_MAX_TRIM: "force" }).stdout); assert.match(o.hookSpecificOutput.updatedInput.command, /pipefail; pytest 2>&1 \| node ".*trim.mjs"/); assert.equal(hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }, { USAGE_MAX_TRIM: "force" }).stdout, ""); assert.equal(hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "pytest" } }, { USAGE_MAX_TRIM: "off" }).stdout, ""); });
  t("hook fail-open on garbage", () => { const r = spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "Stop"], { input: "{{", encoding: "utf8", env }); assert.equal(r.status, 0); });
  t("installer merges hooks.json preserving others", () => { fs.writeFileSync(path.join(ch, "hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } })); for (let i = 0; i < 2; i++) spawnSync("node", [path.join(root, "scripts/install.mjs")], { env }); const h = JSON.parse(fs.readFileSync(path.join(ch, "hooks.json"), "utf8")); assert.equal(h.hooks.Stop.length, 2); assert.ok(JSON.stringify(h).includes("echo mine")); for (const e of ["SessionStart", "UserPromptSubmit", "Stop", "PreToolUse"]) assert.equal(JSON.stringify(h.hooks[e]).split("codex-hook.mjs").length, 2, e); });
  t("models command lists seen models", () => { const r = g("models"); assert.match(r.stdout, /gpt-6\.1-sol/); });
  t("profiles carry plan_mode effort + doc cap", () => { const c = fs.readFileSync(path.join(ch, "usage-max-red.config.toml"), "utf8"); assert.match(c, /plan_mode_reasoning_effort = "medium"/); assert.match(c, /project_doc_max_bytes = 16384/); });
  t("codex-lean passes mode -c overrides, defers in RED", () => { const bin = path.join(home, "bin"); fs.mkdirSync(bin, { recursive: true }); const fake = path.join(bin, process.platform === "win32" ? "codex.cmd" : "codex"); fs.writeFileSync(fake, process.platform === "win32" ? "@echo ARGS:%*\r\n" : "#!/bin/sh\necho ARGS:$@\n", { mode: 0o755 }); const e2 = { ...env, PATH: bin + path.delimiter + process.env.PATH }; const lean = (...a) => spawnSync("node", [path.join(root, "scripts/codex-lean.mjs"), ...a], { env: e2, encoding: "utf8" }); g("mode", "green"); const o = lean("--bare", "exec", "do it").stdout; assert.match(o, /exec/); assert.match(o, /model_reasoning_effort=medium/); assert.match(o, /--ignore-user-config --ignore-rules/); g("mode", "red"); assert.equal(lean("--hold-red", "exec", "x").status, 75); g("mode", "auto"); });
}
console.log(`${n} passing (incl. hooks)`);
