#!/usr/bin/env node
// usage-max safety: every setting or behaviour that can shrink, hide or interrupt what you are working on, whether it is on, and who put it there.
// The rule behind it: usage-max never lowers what Claude or Codex can see, never ends or compacts a conversation for you, and never hides output
// without saving the whole of it. Read-only; `--fix` hands back only the values usage-max itself wrote (yours are never touched).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const home = process.env.USAGE_MAX_HOME || os.homedir();
const jr = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const get = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const toml = (t, k) => { const s = String(t), i = s.search(/^\s*\[/m), head = i < 0 ? s : s.slice(0, i); const m = head.match(new RegExp(`^\\s*${k}\\s*=\\s*([^#\\n]+?)\\s*(?:#.*)?$`, "m")); return m ? m[1].trim() : undefined; }; // top-level keys only, trailing comments ignored

export function claudeRows(h = home) {
  const s = jr(path.join(h, ".claude", "settings.json"), {}), applied = jr(path.join(h, ".claude", "usage-max", "applied.json"), {}), cfg = jr(path.join(h, ".claude", "usage-max", "config.json"), {});
  const who = (k) => (k in applied && JSON.stringify(applied[k]) === JSON.stringify(get(s, k)) ? "usage-max" : "you");
  const rows = [];
  const add = (key, bad, what) => { const v = get(s, key); if (v !== undefined && bad(v)) rows.push({ tool: "Claude", key, value: v, who: who(key), what }); };
  add("autoCompactWindow", (v) => Number(v) < 200000, "compacts (summarises away older detail) earlier than the default");
  add("env.CLAUDE_CODE_DISABLE_AUTO_MEMORY", (v) => v === "1", "turns off Claude's own auto memory");
  add("env.CLAUDE_CODE_DISABLE_CRON", (v) => v === "1", "turns off scheduled tasks and loops");
  add("env.BASH_MAX_OUTPUT_LENGTH", (v) => Number(v) < 30000, "cuts long command output shorter than the default 30000");
  add("alwaysThinkingEnabled", (v) => v === false, "turns off extended thinking");
  add("env.DISABLE_TELEMETRY", (v) => v === "1" || v === 1 || v === true, "switches telemetry off (reported to block Remote Control)");
  add("crossSessionInbound", (v) => v === "hold", "holds messages sent to this session from other sessions or devices");
  add("env.CLAUDE_CODE_ENABLE_AWAY_SUMMARY", (v) => v === "0" || v === 0, "turns off the 'while you were away' recap");
  add("env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY", (v) => v === "1", "turns off feedback prompts");
  add("env.CLAUDE_CODE_GOAL_CHECKIN_MINUTES", (v) => v === "0", "turns off goal check-ins");
  add("env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE", (v) => v === "1", "turns off the terminal title");
  return { rows, leanOptIn: cfg.lean === true };
}
export function codexRows(h = home) {
  const t = (() => { try { return fs.readFileSync(path.join(process.env.CODEX_HOME || path.join(h, ".codex"), "config.toml"), "utf8"); } catch { return ""; } })();
  const legacy = { tool_output_token_limit: 8000, model_auto_compact_token_limit: 64000, project_doc_max_bytes: 16384 };
  const what = { tool_output_token_limit: "cuts every tool result to this many tokens", model_auto_compact_token_limit: "compacts (summarises away detail) once a chat reaches this many tokens", project_doc_max_bytes: "cuts AGENTS.md off after this many bytes" };
  const rows = [];
  for (const [k, w] of Object.entries(what)) { const v = toml(t, k); if (v !== undefined) rows.push({ tool: "Codex", key: k, value: Number(v), who: Number(v) === legacy[k] && jr(path.join(h, ".usage-max-codex", "governor.json"), {}).appliedKey ? "usage-max (older version)" : "you", what: w }); }
  return { rows };
}
export function report(h = home) {
  const c = claudeRows(h), x = codexRows(h), rows = [...c.rows, ...x.rows];
  const L = ["usage-max safety: what could shrink, hide or interrupt your work", ""];
  L.push(rows.length ? "SETTINGS THAT SHRINK CONTEXT OR FEATURES (right now):" : "No setting in Claude or Codex is shrinking your context. Nothing to fix.");
  for (const r of rows) L.push(`  ${r.tool.padEnd(7)} ${r.key} = ${r.value}  (set by ${r.who}) - ${r.what}`);
  L.push("", "WHAT usage-max DOES TO A LIVE SESSION (all of it recoverable):",
    "  - never compacts, clears or ends a conversation for you; its messages only inform (cost, size) and never tell you to give up context mid-task",
    "  - trims noisy command output (tests, installs, builds): the complete output is saved to ~/.usage-max/full-output/ and its path is shown",
    "  - in AMBER/RED (and by default for cheap work) moves subagents from Opus to Sonnet and holds extra parallel subagents past a cap; each change is announced",
    "  - holds a whole-file Read over 400 KB once (asking again goes through); holds extra parallel subagents past a cap",
    "  - writes a resume note at every turn end and before every compaction, with a pointer to the full word-for-word conversation; shows it after a compaction or in a fresh chat",
    "  - in AMBER/RED budget modes only lowers model and effort for NEW sessions (shown in the status line); lean mode (earlier compaction, no auto memory) is OFF unless config.json has {\"lean\": true}" + (c.leanOptIn ? " - it is ON for you" : ""));
  const ours = rows.filter((r) => /usage-max/.test(r.who));
  if (ours.length) L.push("", `${ours.length} of these were written by usage-max. Hand them back: usage-max safety --fix   (your own values are never touched)`);
  return { text: L.join("\n"), ours: ours.length, rows };
}
export async function fix(h = home) {
  const done = [];
  try { const P = await import("./profile.mjs"); const k = P.handBack(h); if (k.length) done.push("Claude: handed back " + k.join(", ")); } catch {}
  try { const G = await import("./governor.mjs"); if (G.releaseLean()) done.push("Claude: handed back the lean-mode values usage-max had written"); } catch {}
  try { const C = await import("../codex/scripts/codex-governor.mjs"); const k = C.cleanLegacy(); if (k.length) done.push("Codex: removed " + k.join(", ")); } catch {}
  return done;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--fix")) { const d = await fix(); console.log(d.length ? d.join("\n") : "nothing usage-max wrote needed handing back."); }
  console.log(report().text);
}
