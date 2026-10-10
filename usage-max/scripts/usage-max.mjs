#!/usr/bin/env node
// usage-max: the one entry point. `/usage-max <sub> ...` in Claude Code, or `node scripts/usage-max.mjs <sub> ...`.
//   (none)|status   plan, mode, pace, surplus and the other plan's headroom
//   doctor          is everything active? (Claude + Codex) and exactly what to fix
//   budget [...]    calibrate <pct> --resets <date> | mode <auto|green|amber|red>
//   gate            exit 0/10/20 = green/amber/red for scripts
//   check|diagnose|audit|diet [...]   reports from local transcripts
//   rescue [apply [--write]|migrate|halt]
//   balance         Claude vs Codex headroom
//   codex <sub>     doctor|status|install|models|calibrate|mode|diet|gate (the Codex side)
//   route|handoff   handled by the model (see commands/usage-max.md)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.USAGE_MAX_HOME || os.homedir();
const S = (f) => path.join(root, "scripts", f);
const C = (f) => path.join(root, "codex", "scripts", f);
const run = (file, args = []) => spawnSync(process.execPath, [file, ...args], { stdio: "inherit" }).status ?? 1;
const json = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const [sub = "status", ...rest] = process.argv.slice(2);

function balance() {
  const sh = json(path.join(home, ".usage-max", "shared.json")) || {};
  const line = (n, e) => (e ? `${n}: ${String(e.mode).toUpperCase()}${e.surplus ? "+SURPLUS" : ""}  week ~${e.estPct == null ? "?" : Math.round(e.estPct)}%  5h ${e.fivePct == null ? "?" : Math.round(e.fivePct)}%  (${Math.round((Date.now() - Date.parse(e.updatedAt)) / 60000)} min ago)` : `${n}: no data yet`);
  console.log(line("Claude", sh.claude)); console.log(line("Codex ", sh.codex));
  const g = (e) => e && Date.now() - Date.parse(e.updatedAt) < 6 * 3600e3 ? e.mode : null;
  const a = g(sh.claude), b = g(sh.codex);
  console.log(a && b && a !== "green" && b === "green" ? "-> Claude is tight and Codex has headroom: send large implementation/review work to Codex." : a && b && b !== "green" && a === "green" ? "-> Codex is tight and Claude has headroom: use Claude for the big work." : "-> no rebalancing needed.");
  return 0;
}

function doctor() {
  const out = []; const ok = (m) => out.push(`  ok   ${m}`); const bad = (m, fix) => out.push(`  FIX  ${m}${fix ? `\n       -> ${fix}` : ""}`);
  const st = json(path.join(home, ".claude", "settings.json")); const gov = json(path.join(home, ".claude", "usage-max", "governor.json")) || {}; const lim = json(path.join(home, ".claude", "usage-max", "limits.json"));
  console.log("usage-max doctor — Claude Code");
  st ? ok("~/.claude/settings.json exists") : bad("no ~/.claude/settings.json", "start a new session (SessionStart configures it) or: usage-max rescue apply --write");
  if (st) {
    st.promptCacheTtl === "5m" && st.model ? ok(`profile applied (model ${st.model}, cache TTL 5m)`) : bad("usage profile not applied", "usage-max rescue apply --write");
    st.statusLine && /usage-max/.test(JSON.stringify(st.statusLine)) ? ok("status line installed (feeds real plan % to the governor)") : bad("usage-max status line not installed", st.statusLine ? "you have your own status line; the governor then needs `budget calibrate`" : "usage-max rescue apply --write");
    st.extraKnownMarketplaces && st.extraKnownMarketplaces["eric-plugins"] && st.extraKnownMarketplaces["eric-plugins"].autoUpdate ? ok("auto-update on for the eric-plugins marketplace") : bad("auto-update not configured", "usage-max rescue apply --write");
  }
  lim ? ok(`real plan % captured ${Math.round((Date.now() - Date.parse(lim.capturedAt)) / 60000)} min ago`) : bad("no plan % captured yet", "it appears after the first reply once the status line renders (needs a claude.ai login)");
  gov.calib ? ok(`governor calibrated (${gov.calib.source}), mode ${String(gov.mode).toUpperCase()}${gov.surplus ? "+SURPLUS" : ""}`) : bad("governor not calibrated", "will learn from the status line, or: usage-max budget calibrate <pct> --resets <date>");
  for (const h of ["session-start", "budget", "bash-trim", "ledger"]) fs.existsSync(path.join(root, "hooks", `${h}.mjs`)) ? 0 : bad(`hook ${h}.mjs missing`);
  console.log(out.join("\n"));
  console.log("\nusage-max doctor — Codex");
  return run(C("codex-governor.mjs"), ["doctor"]);
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
  const code = run(S("governor.mjs"), ["status"]);
  console.log(""); balance();
  return code;
}

const map = {
  status, balance, doctor,
  budget: () => run(S("governor.mjs"), rest.length ? rest : ["status"]),
  gate: () => run(S("governor.mjs"), ["gate"]),
  check: () => run(S("usage-check.mjs"), ["--write-status", path.join(home, ".claude", "usage-max", "status.json"), ...rest]),
  diagnose: () => run(S("diagnose.mjs"), rest),
  audit: () => { const a = run(S("audit.mjs"), rest); return a || run(S("inventory.mjs"), rest); },
  diet: () => run(S("plugin-diet.mjs"), rest),
  rescue: () => rescue(rest),
  codex: () => { const s = rest[0] || "status"; const f = { diet: "codex-diet.mjs", install: "install.mjs", lean: "codex-lean.mjs" }[s]; return f ? run(C(f), rest.slice(1)) : run(C("codex-governor.mjs"), rest.length ? rest : ["status"]); },
  route: () => { console.log("route/handoff are model tasks: follow commands/usage-max.md."); return 0; },
  handoff: () => map.route()
};
process.exit((map[sub] || (() => { console.log(`unknown subcommand "${sub}". Try: status doctor budget gate check diagnose audit diet rescue balance codex route handoff`); return 2; }))());
