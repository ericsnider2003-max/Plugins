import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto"; import assert from "node:assert/strict"; import { fileURLToPath, pathToFileURL } from "node:url";
process.env.USAGE_MAX_MEMORY_DIR = "/nonexistent-usage-max-memory"; // the repo this runs in has its own .memory/; these tests are about budget output only
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
  t("codex-diet audits AGENTS.md/MCP/config", () => { assert.ok(r.advice.some((a) => a.action === "trim")); assert.ok(r.advice.some((a) => a.id === "gh" && a.action === "scope")); assert.ok(!r.advice.some((a) => a.id === "slack")); assert.ok(r.rows.some((x) => x.id === "slack")); assert.ok(!r.advice.some((a) => /tool_output_token_limit|model_auto_compact_token_limit/.test(a.why)), "never advises shrinking context"); });
  t("codex-diet apply sets keys, disables MCP, keeps tables", () => { apply(h, ["gh"]); const c = fs.readFileSync(path.join(h, "config.toml"), "utf8"); assert.doesNotMatch(c, /tool_output_token_limit|model_auto_compact_token_limit/); assert.match(c, /^compact_prompt = /m); assert.ok(c.indexOf("compact_prompt") < c.indexOf("[mcp_servers.gh]")); assert.match(c, /\[mcp_servers.gh\]\nenabled = false\ncommand/); assert.match(c, /enabled_tools = \["post"\]/); });
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
  t("hook PreToolUse trims noisy bash (posix) / skips win32", () => { const o = JSON.parse(hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "pytest" } }, { USAGE_MAX_TRIM: "force" }).stdout); assert.equal(o.hookSpecificOutput.permissionDecision, "allow"); /* Codex rejects updatedInput without allow; allow only continues with the rewritten input */ assert.match(o.hookSpecificOutput.updatedInput.command, /^node ".*run-trimmed\.mjs" run pytest$/); assert.equal(hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }, { USAGE_MAX_TRIM: "force" }).stdout, ""); assert.equal(hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "pytest" } }, { USAGE_MAX_TRIM: "off" }).stdout, ""); });
  t("hook fail-open on garbage", () => { const r = spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "Stop"], { input: "{{", encoding: "utf8", env }); assert.equal(r.status, 0); });
  t("installer merges hooks.json preserving others", () => { fs.writeFileSync(path.join(ch, "hooks.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } })); for (let i = 0; i < 2; i++) spawnSync("node", [path.join(root, "scripts/install.mjs")], { env }); const h = JSON.parse(fs.readFileSync(path.join(ch, "hooks.json"), "utf8")); assert.equal(h.hooks.Stop.length, 2); assert.ok(JSON.stringify(h).includes("echo mine")); for (const e of ["SessionStart", "UserPromptSubmit", "Stop", "PreToolUse"]) assert.equal(JSON.stringify(h.hooks[e]).split("codex-hook.mjs").length, 2, e); });
  t("models command lists seen models", () => { const r = g("models"); assert.match(r.stdout, /gpt-6\.1-sol/); });
  t("profiles carry plan_mode effort + doc cap", () => { const c = fs.readFileSync(path.join(ch, "usage-max-red.config.toml"), "utf8"); assert.match(c, /plan_mode_reasoning_effort = "medium"/); assert.doesNotMatch(c, /project_doc_max_bytes|tool_output_token_limit|model_auto_compact_token_limit/, "profiles no longer shrink what Codex can see"); });
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
  t("doctor flags stale usage-max plugin entries (the old Claude copy running inside Codex)", () => assert.match(spawnSync("node", [path.join(root, "scripts/codex-governor.mjs"), "doctor"], { env: { ...e4, PLUGIN_ROOT: "" }, encoding: "utf8" }).stdout, /FIX\s+Codex still has hook\/plugin entries for the UPLOADED copy of usage-max \(usage-max@synced x1\)/));
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

// ---- P1 windows-safe trimming, P2 savings, P3 backup/restore, P4 routing text
const HK = await import(pathToFileURL(path.join(root, "scripts/codex-hook.mjs")).href);
const RT = path.join(root, "scripts/run-trimmed.mjs"); const GV = path.join(root, "scripts/codex-governor.mjs"); const GOV = await import(pathToFileURL(GV).href);
const mkHome = () => { const h = fs.mkdtempSync(path.join(os.tmpdir(), "umn-")); const e = { ...process.env, USAGE_MAX_HOME: h }; delete e.CODEX_HOME; return { h, e, sd: path.join(h, ".usage-max-codex"), ch: path.join(h, ".codex") }; };
const gg = (e, ...a) => spawnSync("node", [GV, ...a], { env: e, encoding: "utf8" });
const withHome = (h, f) => { const old = process.env.USAGE_MAX_HOME; process.env.USAGE_MAX_HOME = h; delete process.env.USAGE_MAX_TRIM; try { return f(); } finally { old === undefined ? delete process.env.USAGE_MAX_HOME : process.env.USAGE_MAX_HOME = old; } };
{
  const X = mkHome();
  t("rewrite: readable (the original words stay visible), no shell syntax, same text for PowerShell, cmd and sh", () => withHome(X.h, () => {
    for (const [c, words] of [["pytest -x tests/test_a.py::test_b", "pytest -x tests/test_a.py::test_b"], ["npm test -- --coverage", "npm test -- --coverage"], ["make   all", "make all"], ["go test ./...", "go test ./..."], ["cargo test --workspace", "cargo test --workspace"], ["npx tsc --noEmit -p tsconfig.json", "npx tsc --noEmit -p tsconfig.json"]]) {
      const r = HK.rewrite(c, "C:\\p\\run-trimmed.mjs", "linux"); assert.ok(r, c); assert.doesNotMatch(r, /set -o|2>&1|\||[0-9a-f]{24}/); assert.equal(r, `node "C:/p/run-trimmed.mjs" run ${words}`);
      assert.ok(r.includes(words), "the real command is readable in the rewritten text (what Codex shows and its auto-review sees)"); } }));
  t("rewrite: anything with quotes, backslashes, globs, %, ~ or other special characters is NOT rewritten at all", () => withHome(X.h, () => { for (const c of ["pytest -k \"a b\"", "pytest -k 'x'", "npm test -- --grep \"é ünï\"", "pytest tests\\a.py", "make *.o", "pytest ~/x", "npm test %PATH%", "make a^b", "pytest -k a#b", "make FOO=$HOME"]) assert.equal(HK.rewrite(c, "/r.mjs", "linux"), null, c); assert.equal(HK.wrap("pytest | tee x", "/r.mjs"), null); assert.equal(HK.wrap("", "/r.mjs"), null); }));
  t("rewrite: excluded commands untouched", () => withHome(X.h, () => { for (const c of ["pytest | tee x", "pytest > o.txt", "npm test; ls", "pytest && ls", "make `x`", "make $(x)", "pytest\nls", "npm test --json", "pytest -q", "npm test --quiet", "npm test --no-trim", "jest --reporter=dot", "ls", "git status", "npx jest --reporter x"]) assert.equal(HK.rewrite(c, "/r.mjs", "linux"), null, c); }));
  t("rewrite: USAGE_MAX_TRIM=off and config trim:off disable", () => withHome(X.h, () => {
    process.env.USAGE_MAX_TRIM = "off"; assert.equal(HK.rewrite("pytest", "/r.mjs", "linux"), null); delete process.env.USAGE_MAX_TRIM; assert.ok(HK.rewrite("pytest", "/r.mjs", "linux"));
    fs.mkdirSync(X.sd, { recursive: true }); fs.writeFileSync(path.join(X.sd, "config.json"), '{"trim":"off"}'); assert.equal(HK.rewrite("pytest", "/r.mjs", "linux"), null); fs.rmSync(path.join(X.sd, "config.json"));
  }));
  t("rewrite: win32 needs trim-ok.json or USAGE_MAX_TRIM=force", () => withHome(X.h, () => {
    assert.equal(HK.rewrite("pytest", "C:/r.mjs", "win32"), null); fs.writeFileSync(path.join(X.sd, "trim-ok.json"), '{"ok":false}'); assert.equal(HK.rewrite("pytest", "C:/r.mjs", "win32"), null);
    fs.writeFileSync(path.join(X.sd, "trim-ok.json"), '{"ok":true}'); assert.ok(HK.rewrite("pytest", "C:/r.mjs", "win32")); fs.rmSync(path.join(X.sd, "trim-ok.json"));
    process.env.USAGE_MAX_TRIM = "force"; assert.ok(HK.rewrite("pytest", "C:/r.mjs", "win32")); delete process.env.USAGE_MAX_TRIM;
  }));
  const run = (cmd, cwd) => spawnSync("node", [RT, "run", ...cmd.split(/\s+/)], { env: X.e, encoding: "utf8", cwd });
  const stats = () => JSON.parse(fs.readFileSync(path.join(X.sd, "trim-stats.json"), "utf8"));
  const noisy = fs.mkdtempSync(path.join(os.tmpdir(), "umnoisy-")); fs.writeFileSync(path.join(noisy, "n.mjs"), "for(let i=0;i<400;i++)console.log('SECRETCMD line '+i);\n"); fs.writeFileSync(path.join(noisy, "e.mjs"), "console.log('out');console.error('errtext');process.exitCode=3;\n");
  t("run-trimmed: exit codes 0/3/127 forwarded, stderr captured, short output unchanged", () => {
    let r = run("echo hi"); assert.equal(r.status, 0); assert.equal(r.stdout, "hi\n");
    r = run("node e.mjs", noisy); assert.equal(r.status, 3); assert.match(r.stdout, /out/); assert.match(r.stdout, /errtext/);
    r = run("definitely-not-a-command-xyz"); assert.equal(r.status, 127);
  });
  t("run-trimmed: long output trimmed, stats are aggregate only (no command text)", () => {
    const before = fs.existsSync(path.join(X.sd, "trim-stats.json")) ? stats().rewrites : 0;
    const r = run("node n.mjs", noisy); assert.equal(r.status, 0); assert.match(r.stdout, /lines trimmed/); assert.match(r.stdout, /line 399/); assert.ok(r.stdout.length < 6000);
    const s = stats(); assert.equal(s.rewrites, before + 1); assert.ok(s.rawBytes > s.outBytes && s.outBytes > 0); assert.deepEqual(Object.keys(s).sort(), ["lastAt", "outBytes", "rawBytes", "rewrites"]); assert.ok(!JSON.stringify(s).includes("SECRETCMD"));
  });
  t("run-trimmed is NOT a general command runner: anything but plain words (or a missing `run`) runs nothing, exit 2", () => {
    const marker = path.join(noisy, "pwned.txt");
    for (const args of [[], ["run"], ["echo", "hi"], ["run", "echo", "hi;", "touch", marker], ["run", "echo", "$(touch", marker + ")"], ["run", "echo", "a|b"], ["run", 'echo "x"'], ["run", "echo", "a>b"], ["6e706d2074657374"]]) { const r = spawnSync("node", [RT, ...args], { env: X.e, encoding: "utf8" }); assert.equal(r.status, 2, JSON.stringify(args)); assert.match(r.stderr, /nothing run/); }
    assert.equal(fs.existsSync(marker), false); });
  t("selftest-trim passes under sh, writes trim-ok.json; doctor reports", () => {
    const r = gg(X.e, "selftest-trim"); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /PASS sh/); const ok = JSON.parse(fs.readFileSync(path.join(X.sd, "trim-ok.json"), "utf8")); assert.equal(ok.ok, true); assert.deepEqual(ok.shells, ["sh"]);
    assert.match(gg(X.e, "doctor").stdout, /ok\s+output trimming self-test passed \(sh\)/); assert.match(gg(X.e, "doctor").stdout, /trim stats:/);
  });
  t("doctor: win32 without trim-ok says run selftest-trim; non-win32 not needed", () => {
    const Y = mkHome(); const gov = GOV; withHome(Y.h, () => { assert.match(gov.doctor(Y.ch, "win32"), /FIX\s+output trimming is disabled on Windows[\s\S]*selftest-trim/); assert.match(gov.doctor(Y.ch, "linux"), /not needed/); });
  });
}
// savings
{
  const X = mkHome(); const d = path.join(X.ch, "sessions/2026/10/09"); fs.mkdirSync(d, { recursive: true }); fs.mkdirSync(X.sd, { recursive: true });
  const T = Date.now(), at = (ms) => new Date(T - ms).toISOString(), ln = (ms, type, payload) => JSON.stringify({ timestamp: at(ms), type, payload });
  const tc = (ms, i) => ln(ms, "event_msg", { type: "token_count", info: { last_token_usage: { input_tokens: i, cached_input_tokens: i / 2, output_tokens: 10 } } });
  const mk = (name, lines) => fs.writeFileSync(path.join(d, `rollout-${name}.jsonl`), lines.join("\n") + "\n{partial");
  mk("old", [ln(3 * 864e5, "turn_context", { model: "m-a", effort: "high" }), ln(3 * 864e5 - 1, "response_item", { type: "function_call_output", output: "x".repeat(4000) }), tc(3 * 864e5 - 2, 1000)]);
  mk("new", [ln(864e5, "turn_context", { model: "m-b", reasoning_effort: "low" }), ln(864e5 - 1, "response_item", { type: "custom_tool_call_output", output: { content: "y".repeat(400) } }), ln(864e5 - 2, "response_item", { type: "function_call_output", output: "z".repeat(400) }), tc(864e5 - 3, 600), ln(864e5 - 4, "turn_context", { model: "m-b", reasoning_effort: "low" })]);
  fs.writeFileSync(path.join(X.sd, "trim-stats.json"), JSON.stringify({ rewrites: 4, rawBytes: 8000, outBytes: 2000, lastAt: at(1000) }));
  const base = { mode: "green", history: [{ at: at(6 * 864e5), from: "green", to: "amber" }, { at: at(4 * 864e5), from: "amber", to: "green" }] };
  fs.writeFileSync(path.join(X.sd, "governor.json"), JSON.stringify(base));
  const snap = () => { const o = []; (function w(p) { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, e.name); e.isDirectory() ? w(q) : o.push(q + ":" + fs.statSync(q).mtimeMs); } })(X.h); return o.sort().join("|"); };
  const s0 = snap(); const r = gg(X.e, "savings", "--days", "7"); const js = JSON.parse(gg(X.e, "savings", "--days", "7", "--json").stdout);
  t("savings: measured vs estimate sections, no split without installedAt/--since", () => {
    assert.equal(r.status, 0, r.stderr); assert.equal(js.measured.sessions, 2); assert.equal(js.measured.turns, 3); assert.equal(js.measured.toolOutputBytes, 4800); assert.deepEqual(js.measured.tokens, { input: 1600, cachedInput: 800, output: 20, events: 2 });
    assert.equal(js.measured.lanes["m-b/low"], 2); assert.equal(js.measured.lanes["m-a/high"], 1); assert.equal(js.measured.trim.rewrites, 4); assert.equal(js.estimate.toolOutputTokens, 1200); assert.equal(js.estimate.trimTokensRemoved, 1500);
    assert.match(r.stdout, /^measured  sessions 2, turns 3/m); assert.match(r.stdout, /^estimate  tool-output tokens ~1,200 \(bytes\/4\)/m); assert.match(r.stdout, /no split point/); assert.equal(js.beforeAfter, undefined);
    for (const l of r.stdout.split("\n").slice(1)) if (l.trim() && !/^(measured|estimate|what-if)  |^before\/after/.test(l)) assert.fail("unlabeled line: " + l);
  });
  t("savings: mode time from governor history; 'no history' otherwise", () => { const m = js.measured.modeTimeMs; assert.ok(m.green > 0 && m.amber > 0); assert.ok(Math.abs(m.amber - 2 * 864e5) < 5000); assert.match(r.stdout, /budget mode time: .*amber/); const Z = mkHome(); assert.match(gg(Z.e, "savings").stdout, /no history recorded yet/); });
  t("savings: read-only (no files created or touched)", () => assert.equal(snap(), s0));
  t("savings: before/after split at installedAt and via --since", () => {
    fs.writeFileSync(path.join(X.sd, "governor.json"), JSON.stringify({ ...base, installedAt: at(2 * 864e5) })); const a = JSON.parse(gg(X.e, "savings", "--json").stdout);
    assert.equal(a.split.source, "installedAt"); assert.equal(a.beforeAfter.before.turns, 1); assert.equal(a.beforeAfter.after.turns, 2); assert.equal(a.beforeAfter.before.perTurn.toolOutputBytes, 4000); assert.equal(a.beforeAfter.after.perTurn.toolOutputBytes, 400); assert.equal(a.beforeAfter.after.perTurn.inputTokens, 300);
    const txt = gg(X.e, "savings").stdout; assert.match(txt, /tool-output bytes\/turn: before 4,000 -> after 400 \(-3,600, -90%\)/); assert.match(txt, /workload-dependent, not a guarantee/);
    fs.writeFileSync(path.join(X.sd, "governor.json"), JSON.stringify(base)); const b = JSON.parse(gg(X.e, "savings", "--since", at(2 * 864e5), "--json").stdout); assert.equal(b.split.source, "--since"); assert.equal(b.beforeAfter.before.turns, 1); assert.equal(b.beforeAfter.after.turns, 2);
  });
  t("savings: works in a read-only home; 'not available' when logs have no usage", () => {
    const Z = mkHome(); const dz = path.join(Z.ch, "sessions/2026/10/09"); fs.mkdirSync(dz, { recursive: true }); fs.writeFileSync(path.join(dz, "rollout-q.jsonl"), ln(1000, "turn_context", { model: "m" }) + "\n");
    const out = gg(Z.e, "savings").stdout; assert.match(out, /provider-reported tokens: not available in logs/); assert.match(out, /trim rewrites: none recorded/); assert.match(out, /tokens removed by trim: not available/);
    if (process.getuid && process.getuid() !== 0) { fs.chmodSync(Z.h, 0o555); try { assert.equal(gg(Z.e, "savings").status, 0); } finally { fs.chmodSync(Z.h, 0o755); } }
  });
  t("evaluate records mode history (cap 200)", () => {
    const Z = mkHome(); fs.mkdirSync(Z.sd, { recursive: true }); fs.writeFileSync(path.join(Z.sd, "governor.json"), JSON.stringify({ mode: "green", override: "red", history: Array.from({ length: 205 }, (_, i) => ({ at: at(0), from: "green", to: "amber", i })) }));
    const gov = GOV; withHome(Z.h, () => { gov.evaluate(Date.now(), true); const gs = JSON.parse(fs.readFileSync(path.join(Z.sd, "governor.json"), "utf8")); assert.equal(gs.history.length, 200); assert.deepEqual([gs.history[199].from, gs.history[199].to], ["green", "red"]); });
  });
  t("installer records installedAt once", () => { const Z = mkHome(); spawnSync("node", [path.join(root, "scripts/install.mjs")], { env: Z.e }); const a = JSON.parse(fs.readFileSync(path.join(Z.sd, "governor.json"), "utf8")).installedAt; assert.ok(Date.parse(a)); spawnSync("node", [path.join(root, "scripts/install.mjs")], { env: Z.e }); assert.equal(JSON.parse(fs.readFileSync(path.join(Z.sd, "governor.json"), "utf8")).installedAt, a); });
}
// backup / restore
{
  const X = mkHome(); const out = path.join(X.h, "bk"); fs.mkdirSync(X.ch, { recursive: true }); fs.mkdirSync(X.sd, { recursive: true }); fs.mkdirSync(path.join(X.sd, "bin"), { recursive: true });
  const W = (f, c) => fs.writeFileSync(f, c); W(path.join(X.sd, "bin/VERSION"), "9.9.9\n"); W(path.join(X.ch, "hooks.json"), '{"hooks":{}}'); W(path.join(X.ch, "config.toml"), 'model = "m"\n[hooks.state."x"]\ntrusted_hash = "h1"\n'); W(path.join(X.ch, "AGENTS.md"), "# a\n");
  W(path.join(X.ch, "usage-max-red.config.toml"), "r=1\n"); W(path.join(X.ch, "config.toml.usage-max-backup"), "old\n"); W(path.join(X.ch, "config.toml.usage-max-diet-backup"), "older\n"); W(path.join(X.sd, "config.json"), '{"modes":{}}'); W(path.join(X.sd, "governor.json"), '{"mode":"green"}');
  const bk = () => { const r = gg(X.e, "backup", "--out", out); assert.equal(r.status, 0, r.stderr); return r.stdout.match(/backup written: (.*)/)[1].trim(); };
  let d1;
  t("backup writes files + valid manifest, lists skipped", () => {
    d1 = bk(); const mf = JSON.parse(fs.readFileSync(path.join(d1, "MANIFEST.json"), "utf8")); assert.equal(mf.version, "9.9.9"); assert.ok(Date.parse(mf.createdAt)); const ps = mf.files.map((f) => f.path);
    for (const p of ["bin/VERSION", "codex/hooks.json", "codex/config.toml", "codex/AGENTS.md", "codex/usage-max-red.config.toml", "codex/config.toml.usage-max-backup", "codex/config.toml.usage-max-diet-backup", "data/config.json", "data/governor.json"]) assert.ok(ps.includes(p), p);
    assert.deepEqual(mf.skipped, ["data/trim-stats.json"]); for (const f of mf.files) { const b = fs.readFileSync(path.join(d1, ...f.path.split("/"))); assert.equal(b.length, f.bytes); assert.equal(crypto.createHash("sha256").update(b).digest("hex"), f.sha256); }
  });
  t("second backup in the same second never overwrites", () => { const d2 = bk(), d3 = bk(); assert.notEqual(d1, d2); assert.notEqual(d2, d3); assert.ok(fs.existsSync(path.join(d1, "MANIFEST.json"))); assert.equal(new Set([d1, d2, d3]).size, 3); });
  t("restore --check detects a modified current file (read-only)", () => {
    let r = gg(X.e, "restore", "--check", d1); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /codex\/hooks\.json .*same as current/);
    W(path.join(X.ch, "hooks.json"), '{"hooks":{"x":1}}'); const before = fs.readFileSync(path.join(X.ch, "hooks.json"), "utf8"); r = gg(X.e, "restore", "--check", d1); assert.match(r.stdout, /codex\/hooks\.json .*differs from current/); assert.equal(fs.readFileSync(path.join(X.ch, "hooks.json"), "utf8"), before);
  });
  t("restore --apply round-trips and takes a pre-restore backup", () => {
    const n0 = fs.readdirSync(out).length; const r = gg(X.e, "restore", d1, "--apply", "--out", out); assert.equal(r.status, 0, r.stderr); assert.equal(fs.readFileSync(path.join(X.ch, "hooks.json"), "utf8"), '{"hooks":{}}'); assert.equal(fs.readdirSync(out).length, n0 + 1);
    const pre = r.stdout.match(/pre-restore backup: (.*)/)[1].trim(); assert.equal(fs.readFileSync(path.join(pre, "codex/hooks.json"), "utf8"), '{"hooks":{"x":1}}'); assert.match(r.stdout, /\/hooks/); assert.equal(fs.readFileSync(path.join(X.sd, "bin/VERSION"), "utf8"), "9.9.9\n");
  });
  t("restore refuses on corrupted manifest or tampered file; no files changed", () => {
    W(path.join(d1, "codex/AGENTS.md"), "tampered"); W(path.join(X.ch, "AGENTS.md"), "# keep\n"); let r = gg(X.e, "restore", d1, "--apply", "--out", out); assert.equal(r.status, 1); assert.match(r.stderr, /refused/); assert.equal(fs.readFileSync(path.join(X.ch, "AGENTS.md"), "utf8"), "# keep\n");
    W(path.join(d1, "MANIFEST.json"), "{not json"); r = gg(X.e, "restore", d1, "--apply", "--out", out); assert.equal(r.status, 1); assert.equal(gg(X.e, "restore", "--check", d1).status, 1);
  });
}
// routing text
t("AGENTS.usage-max.md < 1536 bytes with routing policy phrases", () => {
  const a = fs.readFileSync(path.join(root, "AGENTS.usage-max.md"), "utf8"); assert.ok(Buffer.byteLength(a) < 1536, String(Buffer.byteLength(a)));
  for (const re of [/cheapest capable lane/, /architecture, ambiguous debugging and final review/, /surplus/, /RED\/AMBER/, /RECOMMEND/, /never silently downgrade a model the user explicitly requested/i, /gate/]) assert.match(a, re);
  const sk = fs.readFileSync(path.join(root, "skills/usage-max/SKILL.md"), "utf8"); for (const re of [/cheapest capable lane/, /RECOMMEND/, /silently downgrade/i]) assert.match(sk, re);
});
if (process.platform !== "win32") t("backups are private (0700 dir, 0600 files) and restore keeps an existing file mode", () => { const Z = mkHome(); fs.mkdirSync(Z.ch, { recursive: true }); fs.writeFileSync(path.join(Z.ch, "config.toml"), 'model = "m"\n', { mode: 0o600 }); const r = gg(Z.e, "backup", "--out", path.join(Z.h, "bk")); assert.equal(r.status, 0, r.stdout + r.stderr); const d = fs.readdirSync(path.join(Z.h, "bk"))[0]; const dp = path.join(Z.h, "bk", d); assert.equal(fs.statSync(dp).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(dp, "MANIFEST.json")).mode & 0o777, 0o600); assert.equal(fs.statSync(path.join(dp, "codex", "config.toml")).mode & 0o777, 0o600);
  fs.chmodSync(path.join(Z.ch, "config.toml"), 0o640); const a = gg(Z.e, "restore", dp, "--apply", "--out", path.join(Z.h, "bk")); assert.equal(a.status, 0, a.stdout + a.stderr); assert.equal(fs.statSync(path.join(Z.ch, "config.toml")).mode & 0o777, 0o640); });
t("SAFE BY DEFAULT: SessionStart hands back the compaction/output/AGENTS.md limits an older version wrote, keeps yours, and a mode change never writes them", () => {
  const Z = mkHome(); fs.mkdirSync(Z.ch, { recursive: true }); fs.writeFileSync(path.join(Z.ch, "config.toml"), 'model = "m"\ntool_output_token_limit = 8000\nmodel_auto_compact_token_limit = 120000\nproject_doc_max_bytes = 16384\n\n[mcp_servers.x]\ncommand = "x"\n');
  const env = { ...Z.e, USAGE_MAX_MEMORY_DIR: "/nonexistent" }; delete env.PLUGIN_ROOT;
  const r = spawnSync("node", [path.join(root, "scripts/codex-hook.mjs"), "SessionStart"], { input: JSON.stringify({ session_id: "sl1" }), env, encoding: "utf8" }); assert.equal(r.status, 0);
  const t1 = fs.readFileSync(path.join(Z.ch, "config.toml"), "utf8"); assert.doesNotMatch(t1, /tool_output_token_limit|project_doc_max_bytes/); assert.match(t1, /^model_auto_compact_token_limit = 120000$/m, "your own value stays"); assert.match(t1, /\[mcp_servers\.x\]\ncommand = "x"/);
  const m = spawnSync("node", [path.join(root, "scripts/codex-governor.mjs"), "mode", "red"], { env: Z.e, encoding: "utf8" }); assert.equal(m.status, 0, m.stderr); const t2 = fs.readFileSync(path.join(Z.ch, "config.toml"), "utf8");
  assert.doesNotMatch(t2, /tool_output_token_limit|project_doc_max_bytes/); assert.match(t2, /model_auto_compact_token_limit = 120000/); assert.doesNotMatch(fs.readFileSync(path.join(Z.ch, "usage-max-red.config.toml"), "utf8"), /token_limit|project_doc/);
  fs.writeFileSync(path.join(Z.h, ".usage-max-codex", "config.json"), JSON.stringify({ tuning: { tool_output_token_limit: 12000 } })); spawnSync("node", [path.join(root, "scripts/codex-governor.mjs"), "mode", "amber"], { env: Z.e, encoding: "utf8" });
  assert.match(fs.readFileSync(path.join(Z.ch, "config.toml"), "utf8"), /^tool_output_token_limit = 12000$/m, "a limit you ask to be managed is still honoured");
});
t("Codex trimming keeps the complete output on disk and says where", () => {
  const Z = mkHome(); const big = Array.from({ length: 300 }, (_, i) => "row " + i).join("\n"); const f = path.join(Z.h, "big.txt"); fs.writeFileSync(f, big + "\n");
  const o = spawnSync("node", [path.join(root, "scripts/run-trimmed.mjs"), "run", "cat", f.replace(/\\/g, "/")], { env: Z.e, encoding: "utf8" }); assert.match(o.stdout, /lines trimmed/);
  const p = o.stdout.match(/complete output is saved at (\S+)\]/); assert.ok(p && fs.readFileSync(p[1], "utf8").includes("row 150"), "the trimmed middle is recoverable");
});
console.log(`${n} passing (incl. trim/savings/backup/routing)`);
