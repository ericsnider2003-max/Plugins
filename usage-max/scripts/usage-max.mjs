#!/usr/bin/env node
// usage-max: the one entry point. `/usage-max <sub> ...` in Claude Code, or `node scripts/usage-max.mjs <sub> ...`.
//   (none)|status   plan, mode, pace, surplus and the other plan's headroom
//   doctor          is everything active? (Claude + Codex) and exactly what to fix
//   providers [--no-refresh] [--json]  refresh provider-owned limits without spending a turn
//   budget [...]    calibrate <pct> --resets <date> | mode <auto|green|amber|red>
//   gate            exit 0/10/20 = green/amber/red for scripts
//   check|diagnose|audit|diet [...]   reports from local transcripts
//   rescue [apply [--write]|migrate|halt]
//   balance         Claude vs Codex headroom
//   context [--archive f]  what CLAUDE.md/AGENTS.md (+ imports) cost on every turn; reversible archive
//   savings [--days N]  what usage-max saved and where more is left, Claude and Codex side by side (measured vs estimate vs what-if)
//   anomaly         is either plan burning much faster than your own usual rate right now, and who is responsible
//   crosscheck <ccusage.json>  compare our Claude total with a ccusage daily JSON export you made yourself (offline; we never run it)
//   trim [on|off]   measured result of the Claude shell-output trim (bytes removed, re-run rate); switches itself off if it causes re-runs
//   budgets [on|off]  opt-in: smaller skill-list and MCP description budgets (cuts first-turn context; rarely used skills may trigger less)
//   cap <usd|off>   optional per-session spend cap (list-price dollars): warns at 80% and 100%, so one runaway session cannot eat the week
//   offload status|<job> <file...>  run bounded jobs (summarize, commit, explain, docstrings, convert:<fmt>) on a model on THIS PC (Ollama): no plan usage, code stays local
//   digest          what the guards did (counts) + Codex measured savings
//   queue add|list|next|clear   low-priority tasks Claude offers when the plan has spare allowance
//   evidence       show measured/estimated/unattributed observation coverage from the local ledger
//   accounts       list/register/approve/revoke configured account slots; never changes credentials
//   adapters       list/enable/disable adapter policies or emergency-stop all adapters
//   service        observation-only status/tick/stop; never launches a model worker
//   compatibility  report missing contracts, stale provider evidence, unknown models, and unavailable surfaces
//   health         one read-only status for service, surfaces, trials, compatibility, and notices
//   subagents      inspect and reconcile durable subagent lifecycle records
//   summary        daily/weekly read-only operating summary
//   workers        list provider worker adapter boundaries
//   activation     inspect automatic hook and attachment readiness
//   readiness      read-only observation-trial and enforcement gate report
//   mcpb [build]   build a clean read-only Claude Desktop/Cowork MCP bundle
//   mcp-http       run the loopback read-only Streamable HTTP MCP bridge for ChatGPT/Secure MCP Tunnel
//   dossier        show a read-only evidence/authority/remedy dossier for every surface
//   chat-prefs      paste-once text for Claude.ai / Cowork / ChatGPT (chats have no hooks)
//   enable-here [dir] [--lean a,b | --lean-auto]  (--lean: turn every other installed plugin off for that repo; --lean-auto: keep only what you used in 30 days) make every session on a repo load usage-max (writes <dir>/.claude/settings.json; commit it)
//   safety [--fix]  what could shrink, hide or interrupt your work, whether it is on, who set it; --fix hands back only values usage-max wrote
//   memory <sub>    init|add|decide|recall|suggest|index|lint|sync|export|import: project memory (suggest lists candidate notes from the repo's docs; --accept N saves only those) in .memory/ (decisions + topic notes, recalled by keyword; sync puts it in AGENTS.md for Codex cloud/mobile)
//   pack "<goal>" [--files a,b] [--test cmd] [--save]   one scoped Codex task prompt (+ memory notes); --save = .codex-tasks/<name>.md for phone use; pack --setup = Codex cloud setup script
//   resume [--repo] show the resume point saved automatically for this folder by Claude Code or Codex (--repo: write a redacted .codex-tasks/RESUME.md for Codex cloud/mobile)
//   codex <sub>     doctor|status|install|models|calibrate|mode|diet|diagnose|weights|gate (the Codex side)
//   route|handoff   handled by the model (see commands/usage-max.md)
//   continuity refresh|enable|disable|write|verify  local deterministic context bridge; never calls a model
//   graph status|build|query|path|explain|god-nodes  native local architecture map; code-only and no model calls
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import { oldSyncedCopies, DISABLE_OLD } from "./dupes.mjs";
import { readJson as rj, writeJsonAtomic } from "./meter.mjs";
import { fixedDecimal } from "./lib.mjs";
import { MARKETPLACE } from "./profile.mjs";
import * as G from "./guard.mjs";
import { diet } from "./plugin-diet.mjs";
import { findBackground } from "./background.mjs";
import { dataDir } from "./meter.mjs";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.USAGE_MAX_HOME || os.homedir();
const S = (f) => path.join(root, "scripts", f);
const C = (f) => path.join(root, "codex", "scripts", f);
const run = (file, args = []) => spawnSync(process.execPath, [file, ...args], { stdio: "inherit" }).status ?? 1;
const json = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const [sub = "status", ...rest] = process.argv.slice(2);

// Make EVERY session on a repo load usage-max with no upload and no per-machine install: the repo's own project settings point at
// the GitHub marketplace (pinned to main, auto-update). Cloud/desktop sessions, local terminals and teammates all pick it up.
// Never overwrites: existing keys are kept, an explicit "false" for the plugin is respected, invalid JSON is left alone.
function enableHere(args) {
  const li = args.indexOf("--lean"); let keep = li >= 0 ? String(args[li + 1] || "").split(",").map((x) => x.trim()).filter(Boolean) : null;
  const dirArg = args.filter((a, i) => !a.startsWith("--") && !(li >= 0 && i === li + 1))[0];
  const dir = path.resolve(dirArg || process.cwd());
  if (args.includes("--lean-auto")) { // keep exactly the plugins you actually used in the last 30 days; refuse without enough history
    const d = diet({ home, cwd: dir });
    if (d.sessionsScanned < 5) { console.log(`--lean-auto needs usage history: only ${d.sessionsScanned} session(s) found in the last ${d.days} days. Use --lean a,b to name the plugins to keep.`); return 1; }
    keep = d.rows.filter((r) => /^plugin/.test(r.kind) && r.uses > 0).map((r) => r.id.split("@")[0]);
    console.log(`lean-auto: keeping ${keep.length ? keep.join(", ") : "(none used)"} — based on ${d.sessionsScanned} sessions in the last ${d.days} days.`);
  }
  const f = path.join(dir, ".claude", "settings.json");
  let s = {};
  if (fs.existsSync(f)) { s = rj(f, null); if (s === null || typeof s !== "object") { console.log(`${f} is not valid JSON; not touching it`); return 1; } }
  const changes = [];
  s.extraKnownMarketplaces = { ...(s.extraKnownMarketplaces || {}) };
  if (!s.extraKnownMarketplaces[MARKETPLACE.name]) { s.extraKnownMarketplaces[MARKETPLACE.name] = { source: { source: "github", repo: MARKETPLACE.repo, ref: MARKETPLACE.ref }, autoUpdate: true }; changes.push(`marketplace ${MARKETPLACE.name} (GitHub, pinned to ${MARKETPLACE.ref}, auto-update)`); }
  s.enabledPlugins = { ...(s.enabledPlugins || {}) };
  if (s.enabledPlugins["usage-max@eric-plugins"] === undefined) { s.enabledPlugins["usage-max@eric-plugins"] = true; changes.push("usage-max@eric-plugins enabled"); }
  else if (s.enabledPlugins["usage-max@eric-plugins"] === false) console.log("usage-max is explicitly turned OFF in that file; leaving it off.");
  if (keep) { // lean set: everything you have installed that is not on the keep list is turned off for THIS repo only
    const off = diet({ home, cwd: dir }).rows.map((r) => r.id).filter((id) => id !== "usage-max@eric-plugins" && !keep.some((k) => id === k || id.split("@")[0] === k) && s.enabledPlugins[id] === undefined);
    for (const id of off) s.enabledPlugins[id] = false;
    if (off.length) changes.push(`${off.length} other plugin(s) off for this repo (kept: ${keep.join(", ")})`);
    for (const k of keep) { const id = Object.keys(s.enabledPlugins).find((x) => x.split("@")[0] === k); if (!id) console.log(`note: "${k}" is not an installed plugin name here, nothing to keep for it`); }
  }
  if (changes.length) { writeJsonAtomic(f, s); console.log(`${f}\n  added: ${changes.join("; ")}\nCommit and push this file: every session on this repo (cloud, desktop app, terminal) then loads usage-max automatically.`); }
  else console.log(`${f}: already set up.`);
  return 0;
}

const digestOf = () => G.digest(dataDir());
function queue(args) {
  const op = args[0] || "list"; const r = G.queueOp(dataDir(), op, args.slice(1).join(" "));
  if (r.error) { console.log(r.error); return 1; }
  if (op === "next") console.log(r.taken ? `next queued task: ${r.taken.text}\n(${r.q.length} left)` : "queue is empty.");
  else { console.log(r.q.length ? r.q.map((x, i) => `${i + 1}. ${x.text}`).join("\n") : "queue is empty. Add low-priority work: usage-max queue add <task>"); if (op === "add") console.log("queued. When the plan shows SURPLUS, Claude offers these."); }
  return 0;
}
function cloudNote() {
  if (process.env.CLAUDE_CODE_REMOTE === "true") console.log("note: this is a CLOUD session. Routing rules and the Sonnet cap on subagents are active. Plan tracking, your settings profile and the status line live on your own computer's Claude Code (cloud sessions start from a blank machine every time). Your weekly % is account-wide, so the reading from your PC covers cloud and chat use too.\n");
}

function balance() {
  const sh = json(path.join(home, ".usage-max", "shared.json")) || {};
  const line = (n, e) => (e ? `${n}: ${String(e.mode).toUpperCase()}${e.surplus ? "+SURPLUS" : ""}  week ~${e.estPct == null ? "?" : Math.round(e.estPct)}%${e.readingAt ? ` (estimate: last real reading ${Math.round(e.readingPct)}% ${Math.round((Date.now() - e.readingAt) / 36e5)}h ago)` : ""}  5h ${e.fivePct == null ? "?" : Math.round(e.fivePct)}%  (${Math.round((Date.now() - Date.parse(e.updatedAt)) / 60000)} min ago)` : `${n}: no data yet`);
  console.log(line("Claude", sh.claude)); console.log(line("Codex ", sh.codex));
  const g = (e) => e && Date.now() - Date.parse(e.updatedAt) < 6 * 3600e3 ? e.mode : null;
  const a = g(sh.claude), b = g(sh.codex);
  console.log(a && b && a !== "green" && b === "green" ? "-> Claude is tight and Codex has headroom: send large implementation/review work to Codex." : a && b && b !== "green" && a === "green" ? "-> Codex is tight and Claude has headroom: use Claude for the big work." : "-> no rebalancing needed.");
  return 0;
}

async function doctor(fix = false) {
  if (fix) { console.log("usage-max doctor --fix: applying the usage profile first (your own settings are never overwritten)"); run(S("profile.mjs"), ["--write"]); console.log("");
    try { if (fs.existsSync(path.join(home, ".usage-max-codex", "bin"))) { const { syncBin } = await import("../codex/scripts/sync.mjs"); const r = syncBin({ root, home }); if (r.changed) console.log(`refreshed the Codex scripts in ~/.usage-max-codex/bin to ${r.version} (config.toml and your hooks are untouched)\n`); } } catch {}
  }
  const out = []; const ok = (m) => out.push(`  ok   ${m}`); const bad = (m, fix) => out.push(`  FIX  ${m}${fix ? `\n       -> ${fix}` : ""}`);
  { const { cleanupClaude } = await import("./cleanup-old.mjs"); out.push(...cleanupClaude({ home, root, fix }).lines); } // older uploaded copies: --fix moves them aside (backed up, reversible); without it, only says what --fix would do
  const st = json(path.join(home, ".claude", "settings.json")); const gov = json(path.join(home, ".claude", "usage-max", "governor.json")) || {}; const lim = json(path.join(home, ".claude", "usage-max", "limits.json"));
  cloudNote();
  console.log("usage-max doctor — Claude Code");
  st ? ok("~/.claude/settings.json exists") : bad("no ~/.claude/settings.json", "start a new session (SessionStart configures it) or: usage-max rescue apply --write");
  if (st) {
    st.promptCacheTtl === "5m" && st.model ? ok(`profile applied (model ${st.model}, cache TTL 5m)`) : bad("usage profile not applied", "usage-max rescue apply --write");
    st.statusLine && /usage-max/.test(JSON.stringify(st.statusLine)) ? ok("status line installed (feeds real plan % to the governor)") : bad("usage-max status line not installed", st.statusLine ? "you have your own status line; the governor then needs `budget calibrate`" : "usage-max rescue apply --write");
    const fromUpload = /[\\/]plugins[\\/]synced[\\/]/.test(root);
    if (fromUpload) ok("installed through the claude.ai / desktop-app upload: no auto-update (re-upload the newer usage-max-plugin zip to update, or install via 1-INSTALL-CLAUDE for automatic updates)");
    else st.extraKnownMarketplaces && st.extraKnownMarketplaces["eric-plugins"] && st.extraKnownMarketplaces["eric-plugins"].autoUpdate ? ok("auto-update on for the eric-plugins marketplace") : bad("auto-update not configured", "usage-max doctor --fix   (or: usage-max rescue apply --write)");
  }
  lim ? ok(`real plan % captured ${Math.round((Date.now() - Date.parse(lim.capturedAt)) / 60000)} min ago`) : bad("no live plan % yet (the status line only exists in the Claude Code TERMINAL app, not the desktop app or Cowork)", "in the terminal app it appears after your first reply; otherwise calibrate once, 10 seconds (read % and reset time from Settings > Usage): usage-max budget calibrate <your weekly %> --resets \"<reset date and time>\"   (or run 4-CALIBRATE-CLAUDE)");
  gov.calib ? ok(`governor calibrated (${gov.calib.source}), mode ${String(gov.mode).toUpperCase()}${gov.surplus ? "+SURPLUS" : ""}`) : bad("governor not calibrated", "will learn from the status line, or: usage-max budget calibrate <pct> --resets <date>");
  { const mt = rj(path.join(home, ".claude", "usage-max", "meter.json"), {}) || {}; const um = Array.isArray(mt.unknownModels) ? mt.unknownModels : []; // models missing from the price table are counted at the nearest family's price, never as free
    um.length ? bad(`${um.length} model name(s) are not in the price table (${um.slice(0, 5).join(", ")}): counted at the nearest family's list price, so cost figures are approximate`, "update usage-max, or tell the maintainer the model name") : ok("every model seen has a known price"); }
  const mine = (json(path.join(root, ".claude-plugin", "plugin.json")) || {}).version || "?";
  let latest = null;
  try { const r = await fetch("https://raw.githubusercontent.com/ericsnider2003-max/Plugins/main/usage-max/.claude-plugin/plugin.json", { signal: AbortSignal.timeout(4000) }); if (r.ok) latest = (await r.json()).version; } catch {}
  const cmpV = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; } return 0; };
  latest === null ? ok(`version ${mine} (could not reach GitHub to compare)`) : latest === mine ? ok(`version ${mine} is the latest on main`) : cmpV(mine, latest) > 0 ? bad(`version ${mine} is AHEAD of main (${latest}): this build is not merged yet`, "merge the pull request, otherwise auto-update can replace this build with the older main. Until then you can turn auto-update off for eric-plugins") : bad(`version ${mine}, latest on main is ${latest}`, "it updates itself at the next Claude Code start (auto-update); or: claude plugin marketplace update eric-plugins");
  const old = oldSyncedCopies(home, root);
  old.length ? bad(`older uploaded copy usage-max ${old[0].version} is enabled next to this one (every hook runs twice)`, DISABLE_OLD) : ok("no duplicate uploaded copy");
  for (const h of ["session-start", "budget", "bash-trim", "ledger", "guard", "cross-gate"]) fs.existsSync(path.join(root, "hooks", `${h}.mjs`)) ? 0 : bad(`hook ${h}.mjs missing`);
  const bg = findBackground();
  bg.length ? bad(`${bg.length} job(s) can keep spending your plan while you are away: ${bg.slice(0, 3).map((b) => b.text).join(" | ")}`, "usage-max rescue halt   (lists how to stop each kind; nothing is stopped for you)") : ok("no scheduled claude/codex jobs or headless runs found");
  console.log(out.join("\n"));
  console.log("\nusage-max doctor — Codex");
  return run(C("codex-governor.mjs"), fix ? ["doctor", "--fix"] : ["doctor"]);
}

function rescue(args) {
  if (args[0] === "apply") return run(S("profile.mjs"), args.slice(1));
  if (args[0] === "migrate") { console.log(fs.readFileSync(path.join(root, "profiles", "background-job.md"), "utf8")); return 0; }
  if (args[0] === "halt") {
    console.log("EMERGENCY STOP — kill every source of background burn:\n  1. `claude agents`: stop every background row (keep none you do not need).\n  2. In each session: cancel /loop and scheduled wakeups (`/loop stop`).\n  3. Desktop Routines / Cowork scheduled tasks: disable them in their UIs.\n  4. OS schedulers: Windows `schtasks /query | findstr claude` then `schtasks /delete /tn <name>`; Linux `crontab -l`.\n  5. Codex: close running `codex exec` jobs; `node scripts/codex-governor.mjs mode red`.\n  6. Pin the budget: `usage-max budget mode red`.");
    return 0;
  }
  console.log("Day-0 rescue:\n  - In active sessions: /model claude-opus-5-5 (never above the ceiling).\n  - Put Sonnet on the agent header before dispatching big work; close idle background sessions.\n  - Apply the profile: usage-max rescue apply   (shows the diff)  then  usage-max rescue apply --write\n  - Background jobs: usage-max rescue migrate  |  emergency: usage-max rescue halt");
  return 0;
}

function status() {
  cloudNote();
  const code = run(S("governor.mjs"), ["status"]);
  console.log(""); balance();
  return code;
}

const map = {
  status, balance, doctor: () => doctor(rest.includes("--fix")), "enable-here": () => enableHere(rest),
  providers: async () => { const { captureProviderLimits } = await import("./provider-limits.mjs"); const r = await captureProviderLimits({ home, refreshClaude: !rest.includes("--no-refresh") }); if (rest.includes("--json")) console.log(JSON.stringify(r, null, 2)); else { for (const [name, c] of Object.entries(r.captures)) console.log(`${name}: ${c.source}, captured ${c.capturedAt} [${r.captureStatus?.[name] || "unknown"}; source=${r.captureSources?.[name] || "cache"}]`); for (const name of ["claude", "codex"].filter((x) => !r.captures[x])) console.log(`${name}: missing [${r.captureStatus?.[name] || "missing"}]`); for (const w of r.warnings) console.log(`warning: ${w}`); } return r.warnings.length && !Object.keys(r.freshCaptures || {}).length ? 1 : 0; },
  budget: () => run(S("governor.mjs"), rest.length ? rest : ["status"]),
  gate: () => run(S("governor.mjs"), ["gate"]),
  compatibility: () => run(S("compatibility-cli.mjs"), rest),
  health: () => run(S("health-cli.mjs"), rest),
  subagents: () => run(S("subagents-cli.mjs"), rest),
  summary: () => run(S("summary-cli.mjs"), rest),
  workers: () => run(S("workers-cli.mjs"), rest),
  activation: () => run(S("activation-cli.mjs"), rest),
  readiness: () => run(S("readiness-cli.mjs"), rest),
  check: () => run(S("usage-check.mjs"), ["--write-status", path.join(home, ".claude", "usage-max", "status.json"), ...rest]),
  diagnose: () => run(S("diagnose.mjs"), rest),
  blocks: () => run(S("blocks.mjs"), rest),
  audit: () => { const a = run(S("audit.mjs"), rest); return a || run(S("inventory.mjs"), rest); },
  diet: () => run(S("plugin-diet.mjs"), rest),
  rescue: () => rescue(rest),
  codex: () => { const s = rest[0] || "status"; const f = { diet: "codex-diet.mjs", install: "install.mjs", lean: "codex-lean.mjs", diagnose: "codex-diagnose.mjs", weights: "codex-weights.mjs" }[s]; return f ? run(C(f), rest.slice(1)) : run(C("codex-governor.mjs"), rest.length ? rest : ["status"]); },
  context: () => run(S("ctxfiles.mjs"), rest),
  safety: () => run(S("safety.mjs"), rest),
  memory: () => run(S("memory-cli.mjs"), rest),
  pack: () => run(S("pack.mjs"), rest),
  resume: () => run(S("resume-cli.mjs"), rest),
  digest: () => { const d = digestOf(); console.log(d.lines.length ? `usage-max actions since ${String(d.since).slice(0, 10)} (counts only; what each saved depends on your work):\n${d.lines.join("\n")}` : "usage-max: nothing recorded yet (the guards count what they do as you work)."); console.log(""); return run(C("codex-governor.mjs"), ["savings"]); },
  savings: async () => {
    const { claudeSavings, formatClaude } = await import("./savings.mjs"); const i = rest.indexOf("--days"); const days = i === -1 ? 7 : Number(rest[i + 1]) || 7;
    console.log(formatClaude(await claudeSavings({ dir: path.join(home, ".claude", "projects"), days }))); console.log("");
    try { const { report } = await import("./anomaly.mjs"); console.log("\nBURN RATE\n" + (await report(home)).text + "\n"); } catch {}
    try { console.log("TRIM (Claude)\n" + (await import("./trimtest.mjs")).report(dataDir()) + "\n"); } catch {}
    console.log("CODEX"); const c = run(C("codex-governor.mjs"), ["savings", "--days", String(days)]);
    try { const { diagnose } = await import("../codex/scripts/codex-diagnose.mjs"); const d = diagnose({ days }); if (d.R.events) console.log("\nCODEX where it went (details: usage-max codex diagnose)\n" + d.findings.map((f) => "  - " + f).join("\n")); } catch {}
    console.log("\nSame yardstick on both: measured = read from your logs; estimate = a stated counterfactual; what-if = a lever, not a saving. Neither side is favoured; spend moves to whichever plan has headroom (`usage-max balance`).");
    return c;
  },
  anomaly: async () => { const { report } = await import("./anomaly.mjs"); console.log((await report(home)).text); return 0; },
  crosscheck: async () => {
    const f = rest[0]; const j = f && json(f); if (!j) { console.log("usage: usage-max crosscheck <ccusage-daily.json>  (export yourself with: ccusage daily --json > file; we never run it for you)"); return 1; }
    const theirs = Number(j.totals?.totalCost ?? (Array.isArray(j.daily) ? j.daily.reduce((a, d) => a + (Number(d.totalCost) || 0), 0) : NaN)); if (!Number.isFinite(theirs)) { console.log("could not find totalCost in that file (format unverified: expected totals.totalCost or daily[].totalCost)."); return 1; }
    const { claudeSavings } = await import("./savings.mjs"); const days = Number(rest[1]) || 7; const ours = (await claudeSavings({ dir: path.join(home, ".claude", "projects"), days })).total;
    console.log(`ours ${fixedDecimal(ours, 2)} vs ccusage ${fixedDecimal(theirs, 2)} (list-price dollars, last ${days} days if you exported that range): ${theirs ? Math.round(100 * (ours - theirs) / theirs) : 0}% apart. Within ~10% means our meter agrees; larger gaps usually mean different date ranges or cache-write pricing.`); return 0;
  },
  trim: async () => { const T = await import("./trimtest.mjs"); const d = dataDir(); if (rest[0] === "on" || rest[0] === "off") { T.setEnabled(d, rest[0] === "on"); console.log(`trim is now ${rest[0].toUpperCase()}`); return 0; } console.log(T.report(d)); return 0; },
  budgets: async () => (await import("./budgets.mjs")).run(rest, home),
  cap: () => { const f = G.capFile(dataDir()); if (!rest[0]) { const c = G.loadCap(dataDir()); console.log(c ? `session cap: $${c} (list price). Change: usage-max cap <usd> | off` : "session cap: off. Set one: usage-max cap 5"); return 0; } if (rest[0] === "off") { try { fs.rmSync(f); } catch {} console.log("session cap off"); return 0; } const v = Number(rest[0]); if (!(v > 0)) { console.log("usage: usage-max cap <dollars>|off"); return 1; } writeJsonAtomic(f, { usd: v }); console.log(`session cap $${v}: you will be warned at 80% and 100% in each session (new prompts only; nothing is blocked)`); return 0; },
  offload: async () => (await import("./offload.mjs")).main(rest),
  queue: () => queue(rest),
  evidence: async () => { const { evidenceReport, formatEvidence } = await import("./evidence.mjs"); const f = path.join(dataDir(), "observations.jsonl"); const r = evidenceReport(f); if (rest.includes("--json")) console.log(JSON.stringify(r, null, 2)); else console.log(formatEvidence(r)); return 0; },
  accounts: () => run(S("accounts-cli.mjs"), rest),
  adapters: () => run(S("adapter-policy-cli.mjs"), rest),
  service: () => run(S("worker-service-cli.mjs"), rest),
  trial: () => run(S("trial-cli.mjs"), rest),
  "plan-audit": async () => { const { implementationPlanAudit, formatPlanAudit } = await import("./plan-audit.mjs"); const r = implementationPlanAudit(); console.log(rest.includes("--json") ? JSON.stringify(r, null, 2) : formatPlanAudit(r)); return r.blockers.length ? 1 : 0; },
  surfaces: async () => { const { manifest } = await import("./surface-adapters.mjs"); console.log(JSON.stringify(manifest(), null, 2)); return 0; },
  report: async () => { const { controlReport, formatControlReport } = await import("./control-report.mjs"); const r = controlReport(home); console.log(rest.includes("--json") ? JSON.stringify(r, null, 2) : formatControlReport(r)); return 0; },
  dashboard: async () => { const { writeDashboard } = await import("./dashboard.mjs"); console.log(`wrote ${writeDashboard(home)}`); return 0; },
  console: () => run(S("task-console-cli.mjs"), rest),
  attachments: () => run(S("attachment-cli.mjs"), rest),
  mcpb: () => run(S("build-mcpb.mjs"), rest[0] === "build" ? rest.slice(1) : rest),
  "mcp-http": () => run(path.join(root, "mcp", "usage-max-mcp-http-server.mjs"), rest),
  dossier: () => run(S("capability-dossier-cli.mjs"), rest),
  "chat-prefs": () => { console.log(fs.readFileSync(path.join(root, "chat-preferences.md"), "utf8")); return 0; },
  route: () => { console.log("route/handoff are model tasks: follow commands/usage-max.md."); return 0; },
  handoff: () => map.route(),
  continuity: () => run(S("context-bridge.mjs"), rest),
  graph: () => run(S("architecture-graph.mjs"), rest),
  advisor: async () => {
    const { analyzeReads, assessSubagentROI, estimateContext, recommendModelEffort } = await import("./usage-advisor.mjs");
    const result = { context: estimateContext({}), modelEffort: recommendModelEffort({}), subagents: assessSubagentROI({}), reads: analyzeReads([]), note: "observation-only defaults; supply task evidence to the library APIs for a useful recommendation" };
    console.log(rest.includes("--json") ? JSON.stringify(result, null, 2) : ["usage-max advisors (observation-only)", `context: ${result.context.status}`, `model/effort: ${result.modelEffort.status} -> ${result.modelEffort.recommended.profile}`, `subagents: ${result.subagents.status}`, `reads: ${result.reads.status}`, result.note].join("\n"));
    return 0;
  },
  workflow: async () => {
    const { planWorkflow, recommendFromHistory } = await import("./workflow-autopilot.mjs");
    const { readWorkflows } = await import("./workflow-ledger.mjs");
    if (rest[0] === "run") {
      if (!rest.includes("--unattended")) { console.error("refused: workflow run requires --unattended"); return 2; }
      const value = (flag) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : null; };
      const planFile = value("--plan"); const observationFile = value("--observation"); const workerFile = value("--worker");
      if (!planFile || !observationFile || !workerFile) { console.error("usage: usage-max workflow run --unattended --plan <plan.json> --observation <observation.json> --worker <worker.mjs>"); return 2; }
      const plan = json(path.resolve(planFile)); const observation = json(path.resolve(observationFile));
      if (!plan || plan.executionMode !== "unattended" || !Array.isArray(plan.stages) || !observation) { console.error("refused: plan must be valid, executionMode=unattended, include stages, and have an observation"); return 2; }
      const workerPath = path.resolve(workerFile); const workerModule = await import(pathToFileURL(workerPath).href);
      if (typeof workerModule.worker !== "function") { console.error("refused: worker module must export worker()"); return 2; }
      const { runWorkflow } = await import("./workflow-runner.mjs");
      const result = await runWorkflow({ home, task: plan.task || null, taskId: plan.taskId, idempotencyKey: plan.idempotencyKey, stages: plan.stages, observation, accountApproved: plan.accountApproved === true, worker: workerModule.worker, verify: workerModule.verify || null, now: plan.now || new Date().toISOString() });
      console.log(JSON.stringify(result, null, 2)); return result.completed ? 0 : 1;
    }
    const prompt = rest.filter((x) => !x.startsWith("--")).join(" ");
    const plan = planWorkflow({ prompt, files: Number(rest[rest.indexOf("--files") + 1]) || 0, executionMode: rest.includes("--unattended") ? "unattended" : "interactive" });
    if (rest[0] === "status") { const records = readWorkflows(home); console.log(JSON.stringify({ records: records.length, latest: records.slice(-10), recommendation: recommendFromHistory(records) }, null, 2)); return 0; }
    if (rest[0] === "recommend") { console.log(JSON.stringify(recommendFromHistory(readWorkflows(home)), null, 2)); return 0; }
    if (rest[0] === "plan" && rest.includes("--save")) { const target = rest[rest.indexOf("--save") + 1]; if (!target) { console.error("usage: usage-max workflow plan <prompt> --save <plan.json>"); return 2; } const saved = { ...plan, taskId: `workflow-${Date.now()}`, idempotencyKey: `workflow-${Date.now()}-key`, executionMode: rest.includes("--unattended") ? "unattended" : "interactive", stages: plan.stages }; fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true }); fs.writeFileSync(path.resolve(target), `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 }); console.log(`saved workflow plan: ${path.resolve(target)}`); return 0; }
    console.log(rest.includes("--json") ? JSON.stringify(plan, null, 2) : [`workflow autopilot: ${plan.classification.complexity}`, `stages: ${plan.stages.join(" -> ")}`, `mode: recommendation-only`, `rationale: ${plan.rationale}`, "interactive work is never blocked", "execution requires an explicit unattended runner integration"].join("\n"));
    return 0;
  }
};
// Anything that is not a subcommand (people type plain English after /usage-max) is not an error: say so once and show status.
if (!map[sub]) { console.log(`("${[sub, ...rest].join(" ").slice(0, 60)}" is not a usage-max option, so here is the status. Options: status providers blocks savings offload cap anomaly trim budgets crosscheck doctor budget gate check diagnose audit diet rescue balance enable-here safety memory pack resume context continuity advisor digest queue evidence accounts service trial plan-audit surfaces report dashboard console attachments mcpb mcp-http dossier chat-prefs graph codex route handoff workflow)\n`); process.exit(await map.status()); }
process.exit(await map[sub]());
