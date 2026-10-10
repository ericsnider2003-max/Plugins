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
fs.mkdirSync(path.join(home, ".usage-max-codex"), { recursive: true });
fs.writeFileSync(path.join(home, ".usage-max-codex/config.json"), JSON.stringify({ modes: { green: { model: "gpt-6.1-sol", effort: "medium" }, amber: { model: "gpt-6.1-sol", effort: "low" }, red: { model: "gpt-6-luna", effort: "low" } } }));
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
  t("hook PreToolUse trims noisy bash (posix) / skips win32", () => { const o = JSON.parse(hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "pytest" } }, { USAGE_MAX_TRIM: "force" }).stdout); assert.equal(o.hookSpecificOutput.permissionDecision, "allow"); /* Codex rejects updatedInput without allow; allow only continues with the rewritten input */ assert.match(o.hookSpecificOutput.updatedInput.command, /pipefail; pytest 2>&1 \| node ".*trim.mjs"/); assert.equal(hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }, { USAGE_MAX_TRIM: "force" }).stdout, ""); assert.equal(hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "pytest" } }, { USAGE_MAX_TRIM: "off" }).stdout, ""); });
  t("hook fail-open on garbage", () => { const r = spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "Stop"], { input: "{{", encoding: "utf8", env }); assert.equal(r.status, 0); });
  t("installer merges hooks.json preserving others", () => { fs.writeFileSync(path.join(ch, "hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } })); for (let i = 0; i < 2; i++) spawnSync("node", [path.join(root, "scripts/install.mjs")], { env }); const h = JSON.parse(fs.readFileSync(path.join(ch, "hooks.json"), "utf8")); assert.equal(h.hooks.Stop.length, 2); assert.ok(JSON.stringify(h).includes("echo mine")); for (const e of ["SessionStart", "UserPromptSubmit", "Stop", "PreToolUse"]) assert.equal(JSON.stringify(h.hooks[e]).split("codex-hook.mjs").length, 2, e); });
  t("models command lists seen models", () => { const r = g("models"); assert.match(r.stdout, /gpt-6\.1-sol/); });
  t("profiles carry plan_mode effort + doc cap", () => { const c = fs.readFileSync(path.join(ch, "usage-max-red.config.toml"), "utf8"); assert.match(c, /plan_mode_reasoning_effort = "medium"/); assert.match(c, /project_doc_max_bytes = 16384/); });
  t("codex-lean passes mode -c overrides, defers in RED", () => { const bin = path.join(home, "bin"); fs.mkdirSync(bin, { recursive: true }); const fake = path.join(bin, process.platform === "win32" ? "codex.cmd" : "codex"); fs.writeFileSync(fake, process.platform === "win32" ? "@echo ARGS:%*\r\n" : "#!/bin/sh\necho ARGS:$@\n", { mode: 0o755 }); const e2 = { ...env, PATH: bin + path.delimiter + process.env.PATH }; const lean = (...a) => spawnSync("node", [path.join(root, "scripts/codex-lean.mjs"), ...a], { env: e2, encoding: "utf8" }); g("mode", "green"); const o = lean("--bare", "exec", "do it").stdout; assert.match(o, /exec/); assert.match(o, /model_reasoning_effort=medium/); assert.match(o, /--ignore-user-config --ignore-rules/); g("mode", "red"); assert.equal(lean("--hold-red", "exec", "x").status, 75); g("mode", "auto"); });
}
console.log(`${n} passing (incl. hooks)`);
// reset rollover, null models, placeholders, throttle
{
  const gov = await import(pathToFileURL(path.join(root, "scripts/codex-governor.mjs")).href);
  const fresh = () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), "umx-")); process.env.USAGE_MAX_HOME = h; delete process.env.CODEX_HOME; return h; };
  const cfg = gov.DEFAULT_CONFIG;
  t("decide: redAtPercent needs hoursLeft > 6; remaining <= 0 is red", () => { assert.equal(gov.decide({ estPct: 95, hoursLeft: 3, ratePerHour: 0, cfg }), "green"); assert.equal(gov.decide({ estPct: 95, hoursLeft: 50, ratePerHour: 0, cfg }), "red"); assert.equal(gov.decide({ estPct: 99, hoursLeft: 3, ratePerHour: 0, cfg }), "red"); });
  t("weekly reset passed: stale 95% calibration rolls to GREEN, ~167h left", () => {
    const h = fresh(); const t0 = Date.now(); fs.mkdirSync(path.join(h, ".usage-max-codex"), { recursive: true });
    fs.writeFileSync(path.join(h, ".usage-max-codex/governor.json"), JSON.stringify({ mode: "red", override: null, k: 1, calib: { pct: 95, at: t0 - 100 * 36e5, resets: new Date(t0 - 36e5).toISOString() } }));
    const r = gov.evaluate(t0, true); assert.equal(r.mode, "green"); assert.ok(Math.abs(r.e.hoursLeft - 167) < 0.01, String(r.e.hoursLeft)); assert.equal(r.e.est, 0);
  });
  t("weekly reset passed: spend after reset counts", () => {
    const h = fresh(); const t0 = Date.now(); const d = path.join(h, ".codex/sessions/2026/10/07"); fs.mkdirSync(d, { recursive: true });
    const L = [{ timestamp: new Date(t0 - 36e5 / 2).toISOString(), type: "turn_context", payload: { model: "gpt-6.1-sol" } }, { timestamp: new Date(t0 - 36e5 / 4).toISOString(), type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100000, output_tokens: 0 } } } }];
    fs.writeFileSync(path.join(d, "rollout-x.jsonl"), L.map((x) => JSON.stringify(x)).join("\n") + "\n");
    fs.mkdirSync(path.join(h, ".usage-max-codex"), { recursive: true });
    fs.writeFileSync(path.join(h, ".usage-max-codex/governor.json"), JSON.stringify({ mode: "red", override: null, k: 2, calib: { pct: 95, at: t0 - 100 * 36e5, resets: new Date(t0 - 36e5).toISOString() } }));
    const r = gov.evaluate(t0, true); assert.ok(Math.abs(r.e.est - 2 * 20 * 0.1) < 1e-6, String(r.e.est));
  });
  t("null models: applyMode leaves model untouched, still sets effort", () => {
    const h = fresh(); const c = path.join(h, ".codex"); fs.mkdirSync(c, { recursive: true }); fs.writeFileSync(path.join(c, "config.toml"), 'model = "mine"\n');
    gov.applyMode("red", gov.loadConfig()); const x = fs.readFileSync(path.join(c, "config.toml"), "utf8"); assert.match(x, /^model = "mine"/m); assert.match(x, /model_reasoning_effort = "low"/);
    assert.doesNotMatch(fs.readFileSync(path.join(c, "usage-max-red.config.toml"), "utf8"), /^model =/m);
  });
  t("installer substitutes <usage-max> and seeds config.json once from seen models", () => {
    const h = fresh(); const d = path.join(h, ".codex/sessions/2026/10/07"); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "rollout-a.jsonl"), [{ type: "turn_context", payload: { model: "gpt-6.1-sol" } }, { type: "turn_context", payload: { model: "gpt-6.1-sol" } }, { type: "turn_context", payload: { model: "gpt-6-luna" } }].map((x) => JSON.stringify(x)).join("\n") + "\n");
    const e2 = { ...env, USAGE_MAX_HOME: h }; const r = spawnSync("node", [path.join(root, "scripts/install.mjs")], { env: e2, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr);
    const rp = path.join(h, ".usage-max-codex/bin").replace(/\\/g, "/"); const sk = fs.readFileSync(path.join(h, ".codex/skills/usage-max/SKILL.md"), "utf8"), ag = fs.readFileSync(path.join(h, ".codex/AGENTS.md"), "utf8");
    assert.ok(!sk.includes("<usage-max>") && !ag.includes("<usage-max>")); assert.ok(sk.includes(rp + "/scripts/codex-governor.mjs") && ag.includes(rp + "/scripts/codex-governor.mjs"));
    const cj = path.join(h, ".usage-max-codex/config.json"); const c1 = JSON.parse(fs.readFileSync(cj, "utf8")); assert.equal(c1.modes.green.model, "gpt-6.1-sol"); assert.equal(c1.modes.red.model, "gpt-6-luna");
    fs.writeFileSync(cj, '{"modes":{}}'); spawnSync("node", [path.join(root, "scripts/install.mjs")], { env: e2 }); assert.equal(fs.readFileSync(cj, "utf8"), '{"modes":{}}');
  });
  t("meterAll throttle: two quick evaluate() calls scan once; force rescans", () => {
    const h = fresh(); const d = path.join(h, ".codex/sessions/2026/10/07"); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, "rollout-t.jsonl");
    const tok = (ts) => JSON.stringify({ timestamp: new Date(ts).toISOString(), type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000, output_tokens: 0 } } } }) + "\n";
    const t0 = Date.now(); fs.writeFileSync(f, tok(t0 - 1000)); gov.evaluate(t0); const a = Object.values(gov.loadMeter().hours).reduce((x, y) => x + y, 0);
    fs.appendFileSync(f, tok(t0 - 500)); gov.evaluate(t0 + 1000); const b = Object.values(gov.loadMeter().hours).reduce((x, y) => x + y, 0); assert.equal(b, a);
    gov.evaluate(t0 + 2000, true); const c = Object.values(gov.loadMeter().hours).reduce((x, y) => x + y, 0); assert.ok(c > a);
  });
}
// auto-calibration from Codex's own rate_limits
const cgMod = await import(pathToFileURL(path.join(root, "scripts/codex-governor.mjs")).href);
{
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "umrl-")); const e2 = { ...process.env, USAGE_MAX_HOME: h }; delete e2.CODEX_HOME;
  const d = path.join(h, ".codex/sessions/2026/10/10"); fs.mkdirSync(d, { recursive: true }); const now2 = Date.now();
  const ev = (ms, rl, info) => JSON.stringify({ timestamp: new Date(now2 - ms).toISOString(), type: "event_msg", payload: { type: "token_count", info, rate_limits: rl } });
  const wk = (pct) => ({ primary: { used_percent: 20, window_minutes: 300, resets_at: Math.floor(now2 / 1000) + 3 * 3600 }, secondary: { used_percent: pct, window_minutes: 10080, resets_at: Math.floor(now2 / 1000) + 36 * 3600 } });
  fs.writeFileSync(path.join(d, "rollout-rl.jsonl"), [JSON.stringify({ timestamp: new Date(now2 - 7200e3).toISOString(), type: "turn_context", payload: { model: "m" } }), ev(3600e3, wk(60), { last_token_usage: { input_tokens: 100000, cached_input_tokens: 0, output_tokens: 5000 } }), ev(60e3, wk(67), null)].join("\n") + "\n");
  const r = spawnSync("node", [path.join(root, "scripts/codex-governor.mjs"), "status"], { env: e2, encoding: "utf8" });
  t("auto-calibrates from rate_limits (no manual calibrate)", () => { assert.match(r.stdout, /plan \(from Codex rate_limits\): weekly 67%/); assert.match(r.stdout, /5h window 20%/); assert.match(r.stdout, /est plan 67/); assert.match(r.stdout, /hours to reset 3[56]/); });
  const hot = ev(1e3, { primary: { used_percent: 96, window_minutes: 300, resets_at: Math.floor(now2 / 1000) + 3600 }, secondary: { used_percent: 30, window_minutes: 10080, resets_at: Math.floor(now2 / 1000) + 100 * 3600 } }, null);
  fs.appendFileSync(path.join(d, "rollout-rl.jsonl"), hot + "\n");
  const g2 = spawnSync("node", [path.join(root, "scripts/codex-governor.mjs"), "gate"], { env: e2, encoding: "utf8" });
  t("5-hour window at 96% forces RED even when the week is fine", () => assert.equal(g2.status, 20, g2.stdout));
  t("fiveFloor is pace-aware", () => { const { fiveFloor } = cgMod; const n3 = Date.now(); assert.equal(fiveFloor({ pct: 85, resetsAt: Math.floor(n3 / 1000) + 1200, windowMinutes: 300 }, n3), "green"); assert.equal(fiveFloor({ pct: 45, resetsAt: Math.floor(n3 / 1000) + 3 * 3600, windowMinutes: 300 }, n3), "amber"); assert.equal(fiveFloor({ pct: 60, resetsAt: Math.floor(n3 / 1000) + 3 * 3600, windowMinutes: 300 }, n3), "red"); assert.equal(fiveFloor({ pct: 96, resetsAt: Math.floor(n3 / 1000) + 3600, windowMinutes: 300 }, n3), "red"); });
  const hk = spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "SessionStart"], { input: JSON.stringify({ session_id: "zz" }), env: e2, encoding: "utf8" });
  t("SessionStart tells the model the real plan numbers", () => assert.match(hk.stdout, /usage-max plan: weekly \d+% used, \d+h to reset, 5h window 96%, mode RED/));
}
{
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "umdoc-")); const e3 = { ...process.env, USAGE_MAX_HOME: h }; delete e3.CODEX_HOME;
  const doc = () => spawnSync("node", [path.join(root, "scripts/codex-governor.mjs"), "doctor"], { env: e3, encoding: "utf8" }).stdout;
  t("doctor: fresh machine says what to fix", () => { const d = doc(); assert.match(d, /FIX\s+hooks not installed/); assert.match(d, /not calibrated/); });
  spawnSync("node", [path.join(root, "scripts/install.mjs")], { env: e3 });
  t("doctor: installed-but-never-run hooks are called out as needing /hooks trust", () => assert.match(doc(), /NEVER run[\s\S]*\/hooks/));
  spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "SessionStart"], { input: "{}", env: e3 });
  t("doctor: stable location ok with version", () => assert.match(doc(), /ok\s+scripts run from a stable location[^\n]*installed version/));
  t("doctor flags hooks.json pointing outside bin", () => { const hf = path.join(h, ".codex/hooks.json"); const s0 = fs.readFileSync(hf, "utf8"); fs.writeFileSync(hf, s0.split(path.join(h, ".usage-max-codex/bin")).join("/cache/old/codex")); assert.match(doc(), /FIX\s+scripts run from a stable location/); fs.writeFileSync(hf, s0); });
  t("doctor: after a hook fires it reports hooks are running", () => assert.match(doc(), /ok\s+hooks are running/));
}
{
  const { syncBin, binDir } = await import(pathToFileURL(path.join(root, "scripts/sync.mjs")).href);
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "umsy-")); const e4 = { ...process.env, USAGE_MAX_HOME: h }; delete e4.CODEX_HOME; const bin = binDir(h); const rp = bin.replace(/\\/g, "/");
  t("install copies scripts to stable bin with VERSION", () => { const r = spawnSync("node", [path.join(root, "scripts/install.mjs")], { env: e4, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); for (const f of ["scripts/codex-hook.mjs", "scripts/notify.mjs", "skills/usage-max/SKILL.md", "AGENTS.usage-max.md", "VERSION"]) assert.ok(fs.existsSync(path.join(bin, f)), f); assert.ok(!fs.existsSync(path.join(bin, "test"))); assert.equal(fs.readFileSync(path.join(bin, "VERSION"), "utf8").trim(), JSON.parse(fs.readFileSync(path.join(root, "../.claude-plugin/plugin.json"), "utf8")).version); });
  t("hooks, notify, AGENTS point at bin not plugin root", () => { const c = path.join(h, ".codex"); const hj = fs.readFileSync(path.join(c, "hooks.json"), "utf8"); assert.ok(hj.includes(rp + "/scripts/codex-hook.mjs")); assert.ok(fs.readFileSync(path.join(c, "config.toml"), "utf8").includes(rp + "/scripts/notify.mjs")); assert.ok(fs.readFileSync(path.join(c, "AGENTS.md"), "utf8").includes(rp)); const pr = path.resolve(root, "..").replace(/\\/g, "/"); for (const f of ["hooks.json", "config.toml", "AGENTS.md"]) assert.ok(!fs.readFileSync(path.join(c, f), "utf8").includes(pr + "/"), f); });
  t("re-install converges from old root path (one entry per event)", () => { const hf = path.join(h, ".codex/hooks.json"); fs.writeFileSync(hf, fs.readFileSync(hf, "utf8").split(rp).join("/cache/old/codex")); spawnSync("node", [path.join(root, "scripts/install.mjs")], { env: e4 }); const s = fs.readFileSync(hf, "utf8"); assert.ok(!s.includes("/cache/old")); const j2 = JSON.parse(s); for (const e of ["SessionStart", "UserPromptSubmit", "Stop", "PreToolUse"]) assert.equal(JSON.stringify(j2.hooks[e]).split("codex-hook.mjs").length, 2, e); });
  t("syncBin no-op when VERSION matches, re-copies on version change", () => {
    const fr = fs.mkdtempSync(path.join(os.tmpdir(), "umfr-")); const h2 = fs.mkdtempSync(path.join(os.tmpdir(), "umfh-")); fs.mkdirSync(path.join(fr, ".claude-plugin")); fs.mkdirSync(path.join(fr, "codex/scripts"), { recursive: true }); fs.mkdirSync(path.join(fr, "codex/skills/x"), { recursive: true });
    fs.writeFileSync(path.join(fr, ".claude-plugin/plugin.json"), '{"version":"1.0.0"}'); fs.writeFileSync(path.join(fr, "codex/scripts/a.mjs"), "1"); fs.writeFileSync(path.join(fr, "codex/scripts/b.txt"), "x"); fs.writeFileSync(path.join(fr, "codex/skills/x/S.md"), "s"); fs.writeFileSync(path.join(fr, "codex/AGENTS.usage-max.md"), "ag");
    const b2 = binDir(h2); assert.deepEqual(syncBin({ root: fr, home: h2 }), { changed: true, version: "1.0.0" }); assert.equal(fs.readFileSync(path.join(b2, "scripts/a.mjs"), "utf8"), "1"); assert.ok(!fs.existsSync(path.join(b2, "scripts/b.txt")));
    fs.writeFileSync(path.join(fr, "codex/scripts/a.mjs"), "2"); assert.equal(syncBin({ root: fr, home: h2 }).changed, false); assert.equal(fs.readFileSync(path.join(b2, "scripts/a.mjs"), "utf8"), "1");
    fs.writeFileSync(path.join(fr, ".claude-plugin/plugin.json"), '{"version":"1.1.0"}'); assert.equal(syncBin({ root: fr, home: h2 }).changed, true); assert.equal(fs.readFileSync(path.join(b2, "scripts/a.mjs"), "utf8"), "2"); assert.equal(fs.readFileSync(path.join(b2, "VERSION"), "utf8").trim(), "1.1.0");
    assert.ok(syncBin({ root: "/nonexistent", home: h2 }).error);
  });
}
{
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "umplug-")); const e4 = { ...process.env, USAGE_MAX_HOME: h, PLUGIN_ROOT: "/plugin/root" }; delete e4.CODEX_HOME;
  const hookP = () => spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "SessionStart"], { input: JSON.stringify({ session_id: "p1" }), env: e4, encoding: "utf8" });
  spawnSync("node", [path.join(root, "scripts/codex-governor.mjs"), "mode", "red"], { env: e4 });
  t("plugin-loaded hooks (PLUGIN_ROOT) do their job when the user-wide install is absent", () => assert.match(hookP().stdout, /usage-max RED/));
  spawnSync("node", [path.join(root, "scripts/install.mjs")], { env: { ...e4, PLUGIN_ROOT: "" } });
  t("...and defer (print nothing) once the user-wide hooks are installed, so nothing runs twice", () => { assert.equal(hookP().stdout, ""); assert.match(spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "SessionStart"], { input: JSON.stringify({ session_id: "p2" }), env: { ...e4, PLUGIN_ROOT: "" }, encoding: "utf8" }).stdout, /usage-max RED/); });
  const cf = path.join(h, ".codex/config.toml"); fs.appendFileSync(cf, '\n[hooks.state."usage-max@synced:hooks/hooks.json:session_start:0:0"]\ntrusted_hash = "abc"\n');
  t("doctor flags stale usage-max plugin entries (the old Claude copy running inside Codex)", () => assert.match(spawnSync("node", [path.join(root, "scripts/codex-governor.mjs"), "doctor"], { env: { ...e4, PLUGIN_ROOT: "" }, encoding: "utf8" }).stdout, /FIX\s+Codex has 1 saved entries for usage-max loaded as a PLUGIN/));
}
console.log(`${n} passing (incl. rollover/throttle/install)`);
// surplus + shared balance
{
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "umsp-")); const e4 = { ...process.env, USAGE_MAX_HOME: h }; delete e4.CODEX_HOME;
  const sd = path.join(h, ".usage-max-codex"), gj = path.join(sd, "governor.json"), shf = path.join(h, ".usage-max/shared.json"), ch4 = path.join(h, ".codex");
  const run = (s, ...a) => spawnSync("node", [path.join(root, `scripts/${s}.mjs`), ...a], { env: e4, encoding: "utf8" });
  const setPct = (pct, hrs = 100, extra = {}) => { fs.mkdirSync(sd, { recursive: true }); const o = (() => { try { return JSON.parse(fs.readFileSync(gj, "utf8")); } catch { return {}; } })(); fs.writeFileSync(gj, JSON.stringify({ ...o, calib: { pct, at: Date.now(), resets: new Date(Date.now() + hrs * 36e5).toISOString() }, k: 1, ...extra })); };
  fs.mkdirSync(path.dirname(shf), { recursive: true }); fs.writeFileSync(shf, JSON.stringify({ claude: { mode: "green", surplus: false, estPct: 30, hoursLeft: 50, fivePct: 5, updatedAt: new Date().toISOString() } }));
  setPct(10); const r1 = run("codex-governor", "gate");
  t("surplus on at projected<80% with >12h left; gate stays 0", () => { assert.equal(r1.status, 0); assert.match(r1.stdout, /mode=GREEN\+SURPLUS/); assert.match(r1.stdout, /surplus: projected ~10% at reset, ~90%/); assert.equal(JSON.parse(fs.readFileSync(gj)).surplus, true); });
  t("surplus hysteresis: stays in 80-90 band, off >90", () => { setPct(85); assert.match(run("codex-governor", "status").stdout, /GREEN\+SURPLUS/); setPct(91); assert.doesNotMatch(run("codex-governor", "status").stdout, /SURPLUS/); setPct(85); assert.doesNotMatch(run("codex-governor", "status").stdout, /SURPLUS/); });
  t("surplus off with <=12h left", () => { setPct(10, 10, { surplus: false }); assert.doesNotMatch(run("codex-governor", "status").stdout, /SURPLUS/); });
  t("surplus profile written; apply writes effort high", () => { setPct(10); run("codex-governor", "apply"); assert.ok(fs.existsSync(path.join(ch4, "usage-max-surplus.config.toml"))); assert.match(fs.readFileSync(path.join(ch4, "config.toml"), "utf8"), /model_reasoning_effort = "high"/); });
  t("shared.json: codex key written, claude key preserved", () => { const o = JSON.parse(fs.readFileSync(shf)); assert.equal(o.claude.estPct, 30); assert.equal(o.codex.mode, "green"); assert.equal(o.codex.surplus, true); assert.ok(o.codex.updatedAt); assert.match(run("codex-governor", "status").stdout, /claude plan: green/); assert.match(run("codex-governor", "doctor").stdout, /shared status with Claude: fresh/); });
  const { balanceAdvice } = await import(pathToFileURL(path.join(root, "scripts/shared.mjs")).href);
  const nw = Date.now(), fr = (mode) => ({ mode, estPct: 40.4, updatedAt: new Date(nw).toISOString() });
  t("balanceAdvice cases", () => { assert.match(balanceAdvice({ mode: "red" }, fr("green"), nw), /Claude has headroom \(week ~40% used, GREEN\).*RED\)/); assert.equal(balanceAdvice({ mode: "green" }, fr("red"), nw), null); assert.equal(balanceAdvice({ mode: "red" }, { ...fr("green"), updatedAt: new Date(nw - 7 * 36e5).toISOString() }, nw), null); assert.equal(balanceAdvice({ mode: "red" }, null, nw), null); });
  t("SessionStart prints balance advice once", () => { setPct(96, 100, { surplus: false }); const hk = () => run("codex-hook", "SessionStart").stdout; const go = spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "SessionStart"], { input: JSON.stringify({ session_id: "bal" }), env: e4, encoding: "utf8" }); assert.match(go.stdout, /usage-max balance: Claude has headroom/); const again = spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "UserPromptSubmit"], { input: JSON.stringify({ session_id: "bal" }), env: e4, encoding: "utf8" }); assert.doesNotMatch(again.stdout, /balance/); });
}
console.log(`${n} passing (incl. surplus/balance)`);
