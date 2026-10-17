#!/usr/bin/env node
// Codex hooks dispatcher: node codex-hook.mjs <SessionStart|UserPromptSubmit|Stop|PreToolUse>. Fail-open (always exit 0).
//  SessionStart     -> meter + evaluate; plain stdout = context (budget directive when AMBER/RED)
//  UserPromptSubmit -> once per session per mode: directive context in AMBER/RED
//  Stop             -> re-evaluate; on mode change apply profile + systemMessage
//  PreToolUse Bash  -> guards (codex-guards.mjs: 3rd identical command note, big `cat` capped) WITHOUT a permission decision, so approval is never changed; then
//  PreToolUse Bash  -> trim noisy simple commands via updatedInput -> `node run-trimmed.mjs run <plain words>` (readable, any shell). Off: USAGE_MAX_TRIM=off or config.json trim:"off".
//                      win32 only after `codex-governor.mjs selftest-trim` wrote trim-ok.json (or USAGE_MAX_TRIM=force).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { recordFailure } from "../../scripts/failure-health.mjs";
// Helpers are loaded with guarded dynamic imports: a half-updated install (a copy that lacks a function, or a file) must make this hook do nothing,
// never fail at startup in the middle of a Codex turn.
const load = async (f) => { try { return await import(f); } catch (error) { try { recordFailure({ home: process.env.USAGE_MAX_HOME || process.env.USERPROFILE || process.env.HOME, component: "codex-hook", event: process.argv[2] || "load", error }); } catch (recordError) { void recordError; } return null; } };
const CGOV = await load("./codex-governor.mjs"), SH = await load("./shared.mjs"), RTR = await load("./run-trimmed.mjs"), GU = await load("./codex-guards.mjs"), TC = await load("./trimcheck.mjs"), SF = await load("./safefile.mjs");
const AO = await load("../../scripts/auto-observe.mjs");
const { evaluate, applyMode, dataDir, modeKey, codexHome } = CGOV || {}; const { readOther, balanceAdvice } = SH || {}; const { guard, sessionContext, nudge, nudgeAt } = GU || {};
export const wrap = RTR ? RTR.wrap : undefined;
const writeAtomic = SF ? SF.writeAtomic : (f, t) => fs.writeFileSync(f, t); // atomic when the helper is there; a plain write is still better than none
const READY = Boolean(CGOV && SH && RTR && GU && TC && evaluate && applyMode && dataDir && modeKey && codexHome && readOther && balanceAdvice && wrap && guard && sessionContext && nudge && nudgeAt && TC.isDisabled && TC.record);
// project memory + shared resume point: ./memory.mjs and ./resume.mjs next to this file (the stable bin copy) or the plugin's scripts/ (running from the plugin). Absent = feature silently off.
let R = null; try { R = await import("./resume.mjs"); } catch { try { R = await import("../../scripts/resume.mjs"); } catch {} }
let SL = null; try { SL = await import("./sessionlog.mjs"); } catch { try { SL = await import("../../scripts/sessionlog.mjs"); } catch {} } // session log (rollout format as parsed by resume.mjs); absent = silently off
let M = null; try { M = await import("./memory.mjs"); } catch { try { M = await import("../../scripts/memory.mjs"); } catch {} }
const NOISY = /^(npm|pnpm|yarn) (install|ci|i|test|run (test|build|lint))\b|^(pip3?|uv pip|poetry) install\b|^(pytest|python3? -m pytest|go test|cargo (test|build|check)|dotnet (test|build)|mvn |gradle |docker build|npx (jest|vitest|tsc|eslint)|tsc\b|make\b)/;
const LONG = /(^|\s)(-w|--watch\w*(=\S+)?|--serve|--dev)(\s|$)|:watch\b|\b(watch|serve|dev|start)\b/i; // never ends: the trimmer streams, but would keep cutting what a watcher prints down to a small window
const rj = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), f), "utf8")); } catch { return null; } };
function localNotifications() {
  try {
    const home = process.env.USAGE_MAX_HOME || process.env.USERPROFILE || process.env.HOME || "";
    const f = path.join(home, ".usage-max", "notifications.jsonl"); if (!fs.existsSync(f)) return "";
    const rows = fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
    const pending = rows.filter((x) => !x.deliveredAt).slice(0, 5); if (!pending.length) return "";
    const ids = new Set(pending.map((x) => x.noticeId)); const now = new Date().toISOString();
    fs.writeFileSync(f, `${rows.map((x) => ids.has(x.noticeId) ? JSON.stringify({ ...x, deliveredAt: now, deliveredSurface: "codex" }) : JSON.stringify(x)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    return pending.map((x) => `usage-max ${x.kind}: ${x.message}`).join("\n");
  } catch { return ""; }
}
export function rewrite(cmd, runPath, platform = process.platform) {
  if (typeof cmd !== "string" || process.env.USAGE_MAX_TRIM === "off") return null;
  // Codex only honours a rewritten command together with permissionDecision "allow", which also skips Codex's own approval prompt for that command.
  // So trimming is OFF unless you opt in with {"trimApprove": true} in ~/.usage-max-codex/config.json (or USAGE_MAX_TRIM=force).
  const cj = rj("config.json"); if (cj && cj.trim === "off") return null;
  if (process.env.USAGE_MAX_TRIM !== "force" && !(cj && cj.trimApprove === true)) return null;
  if (platform === "win32" && process.env.USAGE_MAX_TRIM !== "force") { const ok = rj("trim-ok.json"); if (!ok || ok.ok !== true) return null; }
  const c = cmd.trim(); if (!NOISY.test(c) || LONG.test(c) || /[|><;&`$()]|\n|\r/.test(c) || /--no-trim|--reporter|--json|-q\b|--quiet/.test(c)) return null;
  return wrap(c, runPath);
}
const DIRECTIVE = { amber: "usage-max AMBER: weekly budget is being burned faster than sustainable. Use low reasoning effort, keep scope tight, avoid re-reading files, no large autonomous jobs without asking.", red: "usage-max RED: weekly budget is nearly exhausted for the time left. Cheapest path only: minimal reads, no exploratory work, no fast mode, no long autonomous runs; ask before anything big." };
function seen(ev) { try { const f = path.join(dataDir(), "hook-seen.json"); let o = {}; try { o = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { o = {}; } o[ev] = new Date().toISOString(); writeAtomic(f, JSON.stringify(o)); } catch (e) { return e; } }
function userHooksInstalled() { try { return fs.readFileSync(path.join(codexHome(), "hooks.json"), "utf8").includes("codex-hook.mjs"); } catch { return false; } }
const ignore = (e) => e; // deliberate: a failed best-effort step never stops the hook
function memoryText(ev, input, sid) {
  const mem = M.findMemoryDir(input.cwd || process.cwd()); if (!mem) return "";
  const cfg = rj("config.json"); if (cfg && cfg.memory === "off") return "";
  if (ev === "SessionStart") { try { M.saveSeen(sid, new Set(), path.join(dataDir(), "memory-state")); } catch (e) { ignore(e); } return M.fenceNotes(M.loadBlock(mem, { cap: Number(cfg && cfg.memoryBudgetChars) || 2500, cmd: "(note it in .memory/ — see the block below)", foot: "Record a durable fact or decision when you learn one: append `- YYYY-MM-DD | key | value` to .memory/decisions.md, or a bullet to .memory/topics/<name>.md. Do not ask the user for something listed here." })); }
  const prompt = String(input.prompt || ""), dtv = M.extractDirective(prompt), out = [];
  if (dtv) { const r = M.saveDirective(mem, dtv); if (r.error) out.push(`usage-max: not saved to project memory. ${r.error}`); else if (!r.unchanged) out.push("usage-max: saved to project memory (.memory/decisions.md)."); }
  const sd = path.join(dataDir(), "memory-state"), seen = M.loadSeen(sid, sd), r = M.recall(mem, prompt, { seen });
  if (r.text) { for (const k of r.keys) seen.add(k); M.saveSeen(sid, seen, sd); out.push(M.fenceNotes(r.text)); }
  return out.join("\n");
}
async function main() {
  if (process.env.PLUGIN_ROOT && userHooksInstalled()) return; // loaded as a plugin AND installed user-wide: the user-wide copy handles it
  const ev = process.argv[2]; let input = {}; try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
  if (AO && (ev === "SessionStart" || ev === "UserPromptSubmit")) { try { await AO.autoObserve({ home: process.env.USAGE_MAX_HOME || process.env.USERPROFILE || process.env.HOME, input: { ...input, hook_event_name: ev, surface: "codex-cli" } }); } catch {} }
  seen(ev);
  if (ev === "PreToolUse") {
    if (input.tool_name !== "Bash" || !input.tool_input) return;
    const nc = TC.isDisabled(dataDir()) ? null : rewrite(input.tool_input.command, path.join(path.dirname(fileURLToPath(import.meta.url)), "run-trimmed.mjs"));
    if (nc) TC.record(dataDir(), input.tool_input.command);
    const gc = nc ? null : guard(dataDir(), input.session_id || "?", input.tool_input.command, input.cwd);
    if (gc) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...input.tool_input, command: gc } } })); return; }
    if (nc) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input.tool_input, command: nc } } }));
    return;
  }
  const sid0 = input.session_id || "?";
  if (ev === "SessionStart") { try { if (CGOV.cleanLegacy) CGOV.cleanLegacy(); } catch {} } // safe by default: give back compaction / output / AGENTS.md limits an older version wrote
  if (M && (ev === "SessionStart" || ev === "UserPromptSubmit")) { try { const mt = memoryText(ev, input, sid0); if (mt) process.stdout.write(mt + "\n"); } catch {} } // first: a budget-evaluation failure must not cost you the project notes
  // automatic resume point (shared with Claude Code): written at Stop, offered to the next fresh chat in this folder. Before the budget code on purpose.
  if (R && (ev === "Stop" || ev === "SessionStart")) {
    try {
      const cwdR = input.cwd || process.cwd(), cfgR = rj("config.json") || {};
      if (cfgR.resume !== "off") {
        if (ev === "Stop") R.saveResume(R.sharedDir(), cwdR, () => { const roll = R.findRollout({ transcript: input.transcript_path, sessionId: input.session_id, codexHome: codexHome() }); return roll ? R.buildResume({ transcript: roll, cwd: cwdR, tool: "codex" }) : null; }); // the folder walk and git run only when the note is due
        if (ev === "SessionStart" && (!input.source || input.source === "startup" || input.source === "clear")) { const t = R.takeResume(R.sharedDir(), cwdR, { tool: "codex" }); if (t) process.stdout.write(M.fenceNotes(t, "resume-note") + "\n(Automatic note about the previous session in this folder; it may be stale. Ignore it if the user's request is about something else.)\n"); }
      }
    } catch {}
  }
  if (SL && ev === "Stop") { // session log: new requests since the last Stop, from this session's rollout file only (never a guessed other session)
    try { const cwdL = input.cwd || process.cwd(), roll = R && R.findRollout({ transcript: input.transcript_path, sessionId: input.session_id, codexHome: codexHome() }); if (roll && (input.transcript_path || path.basename(roll).includes(sid0))) SL.recordStop({ cwd: cwdL, sessionId: sid0, transcript: roll, tool: "codex", cfg: rj("config.json") || {} }); } catch (e) { ignore(e); }
  }
  const sf = path.join(dataDir(), "hook-state.json"); let st = {}; try { st = JSON.parse(fs.readFileSync(sf, "utf8")); } catch {}
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir(), "governor.json"), "utf8")); } catch { return {}; } })();
  const before = prev.mode || "green", beforeKey = prev.appliedKey || modeKey(before, prev.surplus);
  const { mode, surplus, cfg, st: gs, e: ge } = evaluate(); const key = modeKey(mode, surplus); if (key !== beforeKey) { try { applyMode(mode, cfg, surplus); } catch {} }
  const sid = input.session_id || "?"; st.sent = st.sent || {};
  if (ev === "SessionStart" || ev === "UserPromptSubmit") {
    const notices = ev === "UserPromptSubmit" ? localNotifications() : ""; if (notices) process.stdout.write(notices + "\n");
    const k = `${sid}:${key}`;
    if (!st.sent[k]) {
      const plan = ev === "SessionStart" && gs.calib && gs.calib.source === "plan" && ge && !ge.rolled ? `usage-max plan: weekly ${Math.round(ge.est)}% used, ${Math.round(ge.hoursLeft)}h to reset${gs.five ? `, 5h window ${Math.round(gs.five.pct)}%` : ""}, mode ${mode.toUpperCase()}. ` : "";
      const text = plan + (DIRECTIVE[mode] || "") + (surplus && ev === "SessionStart" ? "usage-max: allowance is going unused this week — you may use higher reasoning effort for hard problems." : ""); if (text) { st.sent[k] = Date.now(); process.stdout.write(text); } else st.sent[k] = Date.now();
    }
    try { const adv = balanceAdvice({ mode }, readOther()); const ak = `${sid}:adv:${adv}`; if (adv && !st.sent[ak]) { st.sent[ak] = Date.now(); process.stdout.write((st.sent[k] ? "\n" : "") + adv); } } catch {}
    if (ev === "SessionStart") { try { const t = Date.now(), cwd = input.cwd || "?"; st.starts = [...(st.starts || []), { t, cwd, sid }].filter((x) => t - x.t < 600e3).slice(-20); const recent = st.starts.filter((x) => t - x.t < 180e3 && x.cwd === cwd), bk = `burst:${cwd}:${Math.floor(t / 600e3)}`;
      if (recent.length >= 3 && !st.sent[bk]) { st.sent[bk] = t; process.stdout.write(`\nusage-max: ${recent.length} Codex sessions started in this folder within 3 minutes. Each carries its own full context and is billed separately, so running them in parallel multiplies usage. If they are copies of one job, tell the user in one sentence that one session at a time costs far less.`); } } catch {} }
    if (ev === "UserPromptSubmit") { try { const nd = nudge(sessionContext(codexHome(), sid), nudgeAt(mode)); const nk = nd && `${sid}:ctx:${nd.level}`; if (nd && !st.sent[nk]) { st.sent[nk] = Date.now(); process.stdout.write("\n" + nd.text); } } catch {} }
    const keys = Object.keys(st.sent); if (keys.length > 200) for (const x of keys.slice(0, keys.length - 100)) delete st.sent[x];
    try { writeAtomic(sf, JSON.stringify(st)); } catch (e) { return e; }
  } else if (ev === "Stop" && key !== beforeKey) {
    process.stdout.write(JSON.stringify({ systemMessage: `usage-max: budget mode ${beforeKey.toUpperCase()} -> ${key.toUpperCase()}. New sessions use ${cfg.modes[surplus ? "surplus" : mode].model || "your model"} @ ${cfg.modes[surplus ? "surplus" : mode].effort}; use /model to change this one.` }));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { if (READY) await main(); } catch (e) { try { recordFailure({ home: process.env.USAGE_MAX_HOME || process.env.USERPROFILE || process.env.HOME, component: "codex-hook", event: process.argv[2] || "dispatch", error: e }); } catch (recordError) { void recordError; } process.exitCode = 0; } /* a hook must never break a turn */ process.exit(0); }
