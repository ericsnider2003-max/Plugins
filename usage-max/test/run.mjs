#!/usr/bin/env node
// Offline verification only: fixtures, hooks, statusline. No network, no model calls.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeProjects, ceilingStatus, parseResetSpec, weeklyStart, pace } from "../scripts/lib.mjs";
import { replayTtl, priceFor } from "../scripts/pricing.mjs";
import { decide, absorbSnapshot, estimate, DEFAULT_CONFIG } from "../scripts/governor.mjs";
import { recordCost, scanFrom, spendInLast } from "../scripts/meter.mjs";
// Never let a test touch the real ~/.claude (the SessionStart hook configures itself): everything runs in a sandbox home.
const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-sandbox-"));
process.env.USAGE_MAX_HOME = SANDBOX_HOME;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "pass" : "FAIL"} ${name}`);
  if (!ok) {
    failures += 1;
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

function runNode(script, args = [], options = {}) {
  return execFileSync(process.execPath, [script, ...args], { encoding: "utf8", ...options });
}

const summary = await summarizeProjects({ projectsDir: path.join(root, "test", "fixtures") });
check("fixture files", summary.files, 2);
check("fixture turns", summary.assistantTurns, 3);
check("fixture sidechain turns", summary.sidechainTurns, 1);
const noCost = ({ cost, ...rest }) => rest; // cost is asserted in test/new.mjs
check("haiku totals", noCost(summary.models["claude-haiku-4-5-20251001"]), {
  turns: 1,
  sidechainTurns: 1,
  input: 100,
  output: 50,
  created: 200,
  read: 3000,
  context: 3300,
  thinking: 10,
  toolCalls: 1,
  ranges: {}
});
check("sonnet totals", noCost(summary.models["claude-sonnet-5-5"]), {
  turns: 1,
  sidechainTurns: 0,
  input: 200,
  output: 100,
  created: 400,
  read: 5000,
  context: 5600,
  thinking: 0,
  toolCalls: 2,
  ranges: {}
});
check("opus totals", noCost(summary.models["claude-opus-5-5"]), {
  turns: 1,
  sidechainTurns: 0,
  input: 300,
  output: 150,
  created: 600,
  read: 2000,
  context: 2900,
  thinking: 20,
  toolCalls: 1,
  ranges: {}
});
check("all-time context", summary.ranges.all.context, 11800);
check("rework edit tracking", summary.rework.repeatedFiles, { "Edit:src/app.ts": 1 });

// Dynamic window behavior without depending on the wall clock.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-"));
const now = Date.now();
fs.writeFileSync(path.join(temp, "new.jsonl"), `${JSON.stringify({ type: "assistant", timestamp: new Date(now - 60 * 1000).toISOString(), isSidechain: false, message: { model: "claude-sonnet-5-5", content: [], usage: { input_tokens: 10, output_tokens: 5 } } })}\n`);
fs.writeFileSync(path.join(temp, "old.jsonl"), `${JSON.stringify({ type: "assistant", timestamp: new Date(now - 6 * 60 * 60 * 1000).toISOString(), isSidechain: false, message: { model: "claude-sonnet-5-5", content: [], usage: { input_tokens: 10, output_tokens: 5 } } })}\n`);
const windowed = await summarizeProjects({ projectsDir: temp, windows: { last5h: now - 5 * 60 * 60 * 1000 } });
check("5h window turns", windowed.ranges.last5h.turns, 1);
check("5h window context", windowed.ranges.last5h.context, 10);

// SessionStart hook is fail-open and prints the marker.
const marker = runNode(path.join(root, "hooks", "session-start.mjs"), [], { input: "" });
check("session-start marker", marker.includes("usage-max routing-active"), true);
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-home-"));
fs.mkdirSync(path.join(fakeHome, ".claude"));
const ss = (input, env = {}) => runNode(path.join(root, "hooks", "session-start.mjs"), [], { input, env: { ...process.env, USAGE_MAX_HOME: fakeHome, ANTHROPIC_MODEL: "", ANTHROPIC_DEFAULT_OPUS_MODEL: "", USAGE_MAX_AUTOAPPLY: "off", CLAUDE_PLUGIN_ROOT: path.join(os.tmpdir(), "some-other-plugin"), ...env } });
check("session-start: no settings -> not-applied", ss("{}").includes("model=unset (none) profile=not-applied"), true);
fs.writeFileSync(path.join(fakeHome, ".claude", "settings.json"), JSON.stringify({ model: "opusplan" }));
check("session-start: opusplan is no longer the profile", ss("{}").includes("model=opusplan (settings) profile=not-applied"), true);
fs.writeFileSync(path.join(fakeHome, ".claude", "settings.json"), JSON.stringify({ model: "claude-opus-5-5" }));
check("session-start: model without opus-alias pin -> not-applied", ss("{}").includes("profile=not-applied"), true);
fs.writeFileSync(path.join(fakeHome, ".claude", "settings.json"), JSON.stringify({ model: "claude-opus-5-5", env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5-5" } }));
const enforcedOut = ss("{}");
check("session-start: enforced profile", enforcedOut.includes("model=claude-opus-5-5 (settings) profile=enforced"), true);
check("session-start: enforced has no ceiling warning", enforcedOut.includes("ABOVE"), false);
check("session-start: session model wins", ss(JSON.stringify({ model: "claude-haiku-4-5-20251001" })).includes("model=claude-haiku-4-5-20251001 (session) profile=enforced"), true);
check("session-start: fable flagged above ceiling", ss(JSON.stringify({ model: "claude-fable-5" })).includes("ABOVE the Opus 5.5 ceiling"), true);
check("session-start: opus 6 flagged above ceiling", ss(JSON.stringify({ model: "claude-opus-6" })).includes("ABOVE the Opus 5.5 ceiling"), true);
{ const h2 = fs.mkdtempSync(path.join(os.tmpdir(), "um-auto-"));
  const auto = runNode(path.join(root, "hooks", "session-start.mjs"), [], { input: "{}", env: { ...process.env, USAGE_MAX_HOME: h2, ANTHROPIC_MODEL: "", USAGE_MAX_AUTOAPPLY: "" } });
  check("session-start: configures itself when settings are missing", auto.includes("auto-applied the usage profile") && auto.includes("profile=enforced"), true);
  check("session-start: injects routing rules", auto.includes("usage-max rules:") && auto.includes("subagents never above Sonnet"), true);
  check("session-start: auto-apply wrote settings + status line + auto-update", (() => { const x = JSON.parse(fs.readFileSync(path.join(h2, ".claude", "settings.json"), "utf8")); return x.model === "claude-opus-5-5" && x.promptCacheTtl === "5m" && /statusline/.test(x.statusLine.command) && x.extraKnownMarketplaces["eric-plugins"].autoUpdate === true; })(), true);
  const again = runNode(path.join(root, "hooks", "session-start.mjs"), [], { input: "{}", env: { ...process.env, USAGE_MAX_HOME: h2, ANTHROPIC_MODEL: "", USAGE_MAX_AUTOAPPLY: "" } });
  check("session-start: second run is quiet (idempotent)", again.includes("auto-applied"), false);
  const hk = (input) => runNode(path.join(root, "hooks", "budget.mjs"), ["PreToolUse"], { input: JSON.stringify(input), env: { ...process.env, USAGE_MAX_HOME: h2 } });
  check("subagents inheriting Opus run on Sonnet even in GREEN", hk({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "general-purpose" } }).includes('"model":"sonnet"'), true);
  check("explicit opus subagent is capped to Sonnet", hk({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "x", model: "opus" } }).includes('"model":"sonnet"'), true);
  check("haiku scout is left alone", hk({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "usage-max:usage-max-scout", model: "haiku" } }), "");
  const trim = runNode(path.join(root, "hooks", "bash-trim.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm test" } }) });
  check("trim hook rewrites but never auto-approves", trim.includes("updatedInput") && !trim.includes("permissionDecision"), true); }
check("session-start: fail-open on bad stdin", ss("not json").includes("usage-max routing-active"), true);

// Ceiling classification.
check("ceiling opus-5-5 ok", ceilingStatus("claude-opus-5-5"), "ok");
check("ceiling opus-5 ok", ceilingStatus("claude-opus-5"), "ok");
check("ceiling opus-4-8 ok", ceilingStatus("claude-opus-4-8"), "ok");
check("ceiling sonnet/haiku ok", [ceilingStatus("claude-sonnet-5-5"), ceilingStatus("claude-haiku-4-5-20251001")], ["ok", "ok"]);
check("ceiling fable above", ceilingStatus("claude-fable-5"), "above");
check("ceiling opus-6 above", ceilingStatus("claude-opus-6"), "above");
check("ceiling opus-5-6 above", ceilingStatus("claude-opus-5-6"), "above");
check("ceiling unknown model", ceilingStatus("some-new-model"), "unknown");

// Weekly reset spec.
check("reset spec parse", parseResetSpec("Wed 18:30"), { day: 3, hour: 18, minute: 30 });
check("reset spec reject", parseResetSpec("someday 25:00"), null);
const wed = new Date(2026, 9, 7, 12, 0); // Wed Oct 7 2026 12:00 local
check("reset default sun 07:00", weeklyStart(wed).toString(), new Date(2026, 9, 4, 7, 0).toString());
check("reset custom wed 18:30 -> previous week", weeklyStart(wed, { day: 3, hour: 18, minute: 30 }).toString(), new Date(2025 + 1, 8, 30, 18, 30).toString());
check("reset custom wed 09:00 -> today", weeklyStart(wed, { day: 3, hour: 9, minute: 0 }).toString(), new Date(2026, 9, 7, 9, 0).toString());

// usage-check compliance on a synthetic week: Opus hub ok, sidechain Opus -> review, fable -> fail.
function weekDir(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-week-"));
  const ts = new Date(Date.now() - 60 * 1000).toISOString();
  fs.writeFileSync(path.join(dir, "s.jsonl"), records.map(([model, side]) => JSON.stringify({ type: "assistant", timestamp: ts, isSidechain: side, message: { model, content: [], usage: { input_tokens: 1 } } })).join("\n") + "\n");
  return dir;
}
function uc(dir) {
  try {
    return JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts", "usage-check.mjs"), "--projects-dir", dir, "--json"], { encoding: "utf8" }));
  } catch (error) {
    return JSON.parse(error.stdout);
  }
}
check("compliance: opus hub + sonnet/haiku subagents pass", uc(weekDir([["claude-opus-5-5", false], ["claude-sonnet-5-5", true], ["claude-haiku-4-5-20251001", true]])).compliance.status, "pass");
check("compliance: sidechain opus -> review", uc(weekDir([["claude-opus-5-5", false], ["claude-opus-5-5", true]])).compliance.status, "review");
check("compliance: fable -> fail", uc(weekDir([["claude-opus-5-5", false], ["claude-fable-5", false]])).compliance.status, "fail");
check("usage-check reset source arg", JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts", "usage-check.mjs"), "--projects-dir", weekDir([]), "--json", "--reset", "mon 09:00"], { encoding: "utf8" })).weeklyResetSource, "arg");

// Ledger appends and rotates without ever blocking.
const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-ledger-"));
const ledgerFile = path.join(ledgerDir, "ledger.jsonl");
const pad = "x".repeat(1500);
fs.writeFileSync(ledgerFile, `${JSON.stringify({ ts: "old-1", tool: "Read", pad })}\n${JSON.stringify({ ts: "old-2", tool: "Read", pad })}\n`);
const ledgerEnv = { ...process.env, USAGE_MAX_LEDGER_PATH: ledgerFile, USAGE_MAX_LEDGER_MAX_BYTES: "2048" };
runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", session_id: "s1", tool_input: { command: "cargo test" } }), env: ledgerEnv });
const rotated = fs.readdirSync(ledgerDir).filter((name) => name.startsWith("ledger.jsonl."));
check("ledger rotation", rotated.length, 1);
const ledgerLines = fs.readFileSync(ledgerFile, "utf8").trim().split("\n");
check("ledger append", ledgerLines.length, 1);
check("ledger tool", JSON.parse(ledgerLines[0]).tool, "Bash");
const transcript = path.join(ledgerDir, "t.jsonl");
fs.writeFileSync(transcript, [
  { type: "assistant", message: { model: "claude-sonnet-5-5" } },
  { type: "user", message: {} },
  { type: "assistant", message: { model: "claude-opus-5-5" } },
  { type: "assistant", message: { model: "<synthetic>" } }
].map((r) => JSON.stringify(r)).join("\n") + "\n");
runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: JSON.stringify({ tool_name: "Edit", session_id: "s2", transcript_path: transcript, tool_input: { file_path: "/x/a.ts" } }), env: ledgerEnv });
const lastLedger = JSON.parse(fs.readFileSync(ledgerFile, "utf8").trim().split("\n").pop());
check("ledger model from transcript", lastLedger.model, "claude-opus-5-5");
runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", transcript_path: path.join(ledgerDir, "missing.jsonl"), tool_input: { command: "ls" } }), env: ledgerEnv });
check("ledger fail-open on missing transcript", JSON.parse(fs.readFileSync(ledgerFile, "utf8").trim().split("\n").pop()).model, null);

// Pacing on real plan windows.
const NOW = Date.UTC(2026, 9, 7, 12);
const win = (used, hoursLeft) => ({ used_percentage: used, resets_at: Math.floor((NOW + hoursLeft * 3600e3) / 1000) });
const over = pace(win(57, 108), 7 * 86400, NOW);
check("pace over: 57% at 36% elapsed", [over.state, Math.round(over.projected), Math.round(over.capInHours)], ["over", 160, 45]);
check("pace under: 20% at 57% elapsed", [pace(win(20, 72), 7 * 86400, NOW).state, Math.round(pace(win(20, 72), 7 * 86400, NOW).projected)], ["under", 35]);
check("pace on: 50% at half", pace(win(50, 84), 7 * 86400, NOW).state, "on-pace");
check("pace early window has no projection", pace(win(1, 167.9), 7 * 86400, NOW).state, "early");
check("pace missing window", pace(null, 7 * 86400, NOW), null);

// Status line with live rate_limits: shows pacing and snapshots limits for /usage-check.
const slDir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-sl-"));
const limitsFile = path.join(slDir, "limits.json");
const nowS = Math.floor(Date.now() / 1000);
const slIn = { model: { id: "claude-opus-5-5", display_name: "Opus 5.5" }, rate_limits: { five_hour: { used_percentage: 23.5, resets_at: nowS + 3600 }, seven_day: { used_percentage: 57, resets_at: nowS + 108 * 3600 } }, context_window: { used_percentage: 8 }, prompt_cache: { warm: false } };
const slOut = runNode(path.join(root, "scripts", "statusline.mjs"), [], { input: JSON.stringify(slIn), env: { ...process.env, USAGE_MAX_MODEL: "", USAGE_MAX_LIMITS_PATH: limitsFile, USAGE_MAX_HOME: slDir } }).trim();
check("statusline over-pace warning", /^usage-max Opus 5\.5 · wk 57% ⚠ cap in .* · 5h 24% · ctx 8% · cache cold$/.test(slOut), true);
check("statusline wrote limits snapshot", JSON.parse(fs.readFileSync(limitsFile, "utf8")).seven_day.used_percentage, 57);
const under = { ...slIn, rate_limits: { seven_day: { used_percentage: 20, resets_at: nowS + 72 * 3600 } }, prompt_cache: { warm: true } };
check("statusline under-pace says spend more", runNode(path.join(root, "scripts", "statusline.mjs"), [], { input: JSON.stringify(under), env: { ...process.env, USAGE_MAX_MODEL: "", USAGE_MAX_LIMITS_PATH: limitsFile, USAGE_MAX_HOME: slDir } }).includes("unused, spend more"), true);
const ucOut = execFileSync(process.execPath, [path.join(root, "scripts", "usage-check.mjs"), "--projects-dir", path.join(root, "test", "fixtures"), "--limits", limitsFile], { encoding: "utf8" });
check("usage-check uses real plan snapshot", /plan: week 20% used/.test(ucOut) && /UNDER PACE/.test(ucOut), true);

// Cache TTL replay: back-to-back turns favour 5m; a 30-min gap with a big context favours 1h.
const sp = priceFor("claude-sonnet-5-5");
const u = (created, read, output = 100) => ({ input: 0, output, created, read });
const tight = replayTtl([{ t: 0, u: u(40000, 0), p: sp }, { t: 60e3, u: u(2000, 40000), p: sp }, { t: 120e3, u: u(2000, 42000), p: sp }]);
check("ttl replay: tight session cheaper on 5m", tight.sim5m < tight.actual, true);
const gappy = replayTtl([{ t: 0, u: u(2000, 0), p: sp }, { t: 30 * 60e3, u: u(1000, 400000), p: sp }]);
check("ttl replay: 30-min gap on 400k context cheaper on 1h", gappy.sim5m > gappy.actual, true);
check("pricing: opus 5.5 cache read $0.20/M", priceFor("claude-opus-5-5").read, 0.2);


// Governor decisions.
const D = (estPct, hoursLeft, ratePerHour, prevMode = "green") => decide({ estPct, hoursLeft, ratePerHour, prevMode, config: DEFAULT_CONFIG });
check("governor: Eric's case 60% Wed, 94h left, 0.9%/h -> red", D(60, 94, 0.9).mode, "red");
check("governor: sustainable burn -> green", D(60, 94, 0.35).mode, "green");
check("governor: 1.2x sustainable -> amber", D(60, 94, 0.4851).mode, "amber");
check("governor: >=92% with time left -> red", D(93, 30, 0.01).mode, "red");
check("governor: hysteresis keeps red until clearly under", D(60, 94, 0.55, "red").mode, "red");
check("governor: red relaxes one step to amber", D(60, 94, 0.5, "red").mode, "amber");
check("governor: no calibration keeps previous mode", D(null, null, null, "amber").mode, "amber");
const st = { k: 0.2, calib: { pct: 50, at: 1000, cumAt: 100, resetsAt: Math.floor(Date.now() / 1000) + 50 * 3600 } };
absorbSnapshot(st, { capturedAt: new Date(5000).toISOString(), seven_day: { used_percentage: 54, resets_at: st.calib.resetsAt } }, 110);
check("governor: snapshot refines k (smoothed) and re-bases", [Number(st.k.toFixed(3)), st.calib.pct, st.calib.cumAt], [0.26, 54, 110]);
const est = estimate(st, { cum: 120, buckets: { [new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString()]: 6 } }, Date.now(), DEFAULT_CONFIG);
check("governor: estimate = snapshot + k*spend", Number(est.estPct.toFixed(1)), 56.6);

// Meter pricing honours the real 5m/1h write split.
check("meter: opus 5.5 turn cost", Number(recordCost({ model: "claude-opus-5-5", usage: { input_tokens: 0, output_tokens: 1000, cache_read_input_tokens: 100000, cache_creation_input_tokens: 10000, cache_creation: { ephemeral_5m_input_tokens: 10000, ephemeral_1h_input_tokens: 0 } } }).toFixed(4)), 0.09);
const mt = path.join(slDir, "meter-t.jsonl");
fs.writeFileSync(mt, JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { model: "claude-sonnet-5-5", usage: { output_tokens: 1000 } } }) + "\n" + '{"type":"assistant","partial');
const s1 = scanFrom(mt, 0);
check("meter: counts whole lines only", [Number(s1.cost.toFixed(4)), s1.end < fs.statSync(mt).size], [0.01, true]);
check("meter: incremental re-scan adds nothing", scanFrom(mt, s1.end).cost, 0);

// Budget hooks end to end, in an isolated home.
const gh = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-gov-"));
fs.mkdirSync(path.join(gh, ".claude", "usage-max"), { recursive: true });
fs.writeFileSync(path.join(gh, ".claude", "settings.json"), JSON.stringify({ model: "claude-opus-5-5", effortLevel: "medium", enabledPlugins: { x: true } }));
const nowSec = Math.floor(Date.now() / 1000);
fs.writeFileSync(path.join(gh, ".claude", "usage-max", "governor.json"), JSON.stringify({ mode: "green", appliedMode: "green", override: null, k: 0.5, calib: { pct: 60, at: Date.now() - 1000, cumAt: 0, resetsAt: nowSec + 94 * 3600, source: "test" }, sessionsNotified: {}, history: [] }));
const gproj = path.join(gh, ".claude", "projects", "p");
fs.mkdirSync(gproj, { recursive: true });
const tp = path.join(gproj, "s1.jsonl");
fs.writeFileSync(tp, Array.from({ length: 20 }, () => JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { model: "claude-opus-5-5", usage: { output_tokens: 50000 } } })).join("\n") + "\n");
const genv = { ...process.env, USAGE_MAX_HOME: gh, USAGE_MAX_LIMITS_PATH: path.join(gh, "none.json") };
const hook = (ev, obj) => runNode(path.join(root, "hooks", "budget.mjs"), [ev], { input: JSON.stringify({ hook_event_name: ev, ...obj }), env: genv });
const stopOut = hook("Stop", { session_id: "s1", transcript_path: tp });
const gstate = JSON.parse(fs.readFileSync(path.join(gh, ".claude", "usage-max", "governor.json"), "utf8"));
check("hook Stop: metered $20 and switched to red", [gstate.mode, /GREEN → RED/.test(stopOut)], ["red", true]);
const gset = JSON.parse(fs.readFileSync(path.join(gh, ".claude", "settings.json"), "utf8"));
check("hook Stop: new sessions -> sonnet @ low, other keys kept", [gset.model, gset.effortLevel, gset.modelSettings["claude-opus-5-5"].effortLevel, gset.enabledPlugins.x], ["claude-sonnet-5-5", "low", "low", true]);
check("hook Stop: re-run does not double count", (hook("Stop", { session_id: "s1", transcript_path: tp }), JSON.parse(fs.readFileSync(path.join(gh, ".claude", "usage-max", "meter.json"), "utf8")).cum), 20);
const ups1 = hook("UserPromptSubmit", { session_id: "s9" });
check("hook UserPromptSubmit: directive once per session", [/RED/.test(JSON.parse(ups1).hookSpecificOutput.additionalContext), hook("UserPromptSubmit", { session_id: "s9" }).trim()], [true, ""]);
const ag = JSON.parse(hook("PreToolUse", { tool_name: "Agent", tool_input: { prompt: "x", subagent_type: "general-purpose" } }));
check("hook PreToolUse: red downgrades inheriting subagent to sonnet", [ag.hookSpecificOutput.updatedInput.model, ag.hookSpecificOutput.updatedInput.prompt], ["sonnet", "x"]);
check("hook PreToolUse: leaves usage-max-scout alone", hook("PreToolUse", { tool_name: "Agent", tool_input: { prompt: "x", subagent_type: "usage-max:usage-max-scout" } }).trim(), "");
check("hook PreModelSwitch: blocks fable", JSON.parse(hook("PreModelSwitch", { to_model: "claude-fable-5" })).hookSpecificOutput.permissionDecision, "deny");
check("hook PreModelSwitch: asks for opus in red", JSON.parse(hook("PreModelSwitch", { to_model: "claude-opus-5-5" })).hookSpecificOutput.permissionDecision, "ask");
check("hook: fail-open on garbage", runNode(path.join(root, "hooks", "budget.mjs"), ["Stop"], { input: "garbage", env: genv }).trim(), "");

// Subagent attribution: agent_id resolves <project>/<session>/subagents/agent-<id>.jsonl.
const proj = path.join(ledgerDir, "proj");
fs.mkdirSync(path.join(proj, "sess1", "subagents"), { recursive: true });
const mainT = path.join(proj, "sess1.jsonl");
fs.writeFileSync(mainT, JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5" } }) + "\n");
fs.writeFileSync(path.join(proj, "sess1", "subagents", "agent-abc123.jsonl"), JSON.stringify({ type: "assistant", isSidechain: true, message: { model: "claude-haiku-4-5-20251001" } }) + "\n");
const lastOf = () => JSON.parse(fs.readFileSync(ledgerFile, "utf8").trim().split("\n").pop());
runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: JSON.stringify({ tool_name: "Read", session_id: "sess1", transcript_path: mainT, agent_id: "abc123", agent_type: "usage-max:usage-max-scout", tool_input: {} }), env: ledgerEnv });
check("ledger subagent model via agent_id", [lastOf().model, lastOf().scope], ["claude-haiku-4-5-20251001", "subagent"]);
runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: JSON.stringify({ tool_name: "Read", session_id: "sess1", transcript_path: mainT, tool_input: {} }), env: ledgerEnv });
check("ledger hub model without agent_id", [lastOf().model, lastOf().scope], ["claude-opus-5-5", "hub"]);
runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: JSON.stringify({ tool_name: "Read", session_id: "sess1", transcript_path: mainT, agent_id: "missing", tool_input: {} }), env: ledgerEnv });
check("ledger unknown subagent never falls back to hub model", [lastOf().model, lastOf().scope], [null, "subagent"]);

// Above-ceiling warning: emitted once per session+model, as a systemMessage.
const fableT = path.join(proj, "fable.jsonl");
fs.writeFileSync(fableT, JSON.stringify({ type: "assistant", message: { model: "claude-fable-5" } }) + "\n");
const warnIn = JSON.stringify({ tool_name: "Bash", session_id: "sf", transcript_path: fableT, tool_input: { command: "ls" } });
const w1 = runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: warnIn, env: ledgerEnv });
const w2 = runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: warnIn, env: ledgerEnv });
check("ceiling warning first time", (() => { try { return JSON.parse(w1).systemMessage.includes("ABOVE the Opus 5.5 ceiling"); } catch { return false; } })(), true);
check("ceiling warning not repeated", w2.trim(), "");
check("no warning for opus 5.5", runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", session_id: "s55", transcript_path: mainT, tool_input: { command: "ls" } }), env: ledgerEnv }).trim(), "");

// Debug capture writes raw hook input only when enabled.
const dbg = path.join(ledgerDir, "hook-debug.jsonl");
runNode(path.join(root, "hooks", "ledger.mjs"), [], { input: "{\"tool_name\":\"Bash\"}", env: { ...ledgerEnv, USAGE_MAX_HOOK_DEBUG: dbg } });
check("hook debug capture", JSON.parse(fs.readFileSync(dbg, "utf8").trim()).hook, "PostToolUse");

// Statusline reads generated status only.
const statusFile = path.join(ledgerDir, "status.json");
fs.writeFileSync(statusFile, JSON.stringify({ contextPerDay: 8100, opusTurns: 3, projectedDaysLeft: 2.4 }));
const status = runNode(path.join(root, "scripts", "statusline.mjs"), [], { env: { ...process.env, USAGE_MAX_HOME: ledgerDir, USAGE_MAX_STATUS_PATH: statusFile, USAGE_MAX_MODEL: "claude-opus-5-5" } });
check("statusline output", status.trim(), "usage-max claude-opus-5-5 · 8.1K/day · opus 3");
const big = path.join(ledgerDir, "status-big.json");
fs.writeFileSync(big, JSON.stringify({ contextPerDay: 62354395, opusTurns: 156, projectedDaysLeft: null }));
const bigOut = runNode(path.join(root, "scripts", "statusline.mjs"), [], { input: JSON.stringify({ model: { id: "claude-sonnet-5-5", display_name: "Sonnet 5.5" } }), env: { ...process.env, USAGE_MAX_HOME: ledgerDir, USAGE_MAX_STATUS_PATH: big, USAGE_MAX_MODEL: "" } });
check("statusline flags above-ceiling live model", runNode(path.join(root, "scripts", "statusline.mjs"), [], { input: JSON.stringify({ model: { id: "claude-fable-5", display_name: "Fable" } }), env: { ...process.env, USAGE_MAX_HOME: ledgerDir, USAGE_MAX_STATUS_PATH: statusFile, USAGE_MAX_MODEL: "" } }).includes("ABOVE OPUS 5.5 CEILING"), true);
check("statusline live model + compact", bigOut.trim(), "usage-max Sonnet 5.5 · 62.4M/day · opus 156");

// gate + claude-lean launcher
{
  const gh = fs.mkdtempSync(path.join(os.tmpdir(), "um-gate-"));
  const genv = { ...process.env, USAGE_MAX_HOME: gh };
  const gs = (...a) => spawnSync(process.execPath, [path.join(root, "scripts", "governor.mjs"), ...a], { env: genv, encoding: "utf8" });
  check("gate green exit 0", gs("mode", "green").status === 0 && gs("gate").status, 0);
  check("gate amber exit 10", (gs("mode", "amber"), gs("gate").status), 10);
  check("gate red exit 20", (gs("mode", "red"), gs("gate").status), 20);
  const bin = path.join(gh, "bin"); fs.mkdirSync(bin);
  const fake = process.platform === "win32" ? path.join(bin, "claude.cmd") : path.join(bin, "claude");
  fs.writeFileSync(fake, process.platform === "win32" ? "@echo ARGS:%*\r\n" : "#!/bin/sh\necho ARGS:$@\n", { mode: 0o755 });
  const lean = (...a) => spawnSync(process.execPath, [path.join(root, "scripts", "claude-lean.mjs"), ...a], { env: { ...genv, PATH: bin + path.delimiter + process.env.PATH }, encoding: "utf8" });
  const r1 = lean("--hold-red", "-p", "hi");
  check("claude-lean defers in RED", r1.status, 75);
  check("claude-lean injects mode model (red=sonnet)", /--model claude-sonnet-5-5/.test(lean("-p", "hi").stdout), true);
  check("claude-lean downgrades opus in RED", /--model claude-sonnet-5-5/.test(lean("-p", "hi", "--model", "claude-opus-5-5").stdout), true);
  check("claude-lean --force-model keeps opus", /--model claude-opus-5-5/.test(lean("--force-model", "-p", "hi", "--model", "claude-opus-5-5").stdout), true);
  check("claude-lean adds --max-turns for -p", /--max-turns 40/.test(lean("-p", "hi").stdout), true);
  check("claude-lean keeps caller --max-turns", /--max-turns 5(\s|$)/.test(lean("-p", "hi", "--max-turns", "5").stdout) && !/--max-turns 40/.test(lean("-p", "hi", "--max-turns", "5").stdout), true);
  gs("mode", "green");
  check("claude-lean runs in GREEN with opus", /--model claude-opus-5-5/.test(lean("--hold-red", "-p", "hi").stdout), true);
}

{
  const r = spawnSync(process.execPath, [path.join(root, "test", "new.mjs")], { encoding: "utf8" });
  check("diet/eval-cache/trim tests", r.status, 0);
  if (r.status !== 0) console.error(r.stdout + r.stderr);
}
if (failures > 0) {
  console.error(`\n${failures} offline test(s) failed`);
  process.exit(1);
}
console.log("\nAll offline tests passed");
