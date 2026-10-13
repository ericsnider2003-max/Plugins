#!/usr/bin/env node
// Status line: live model + ceiling flag, real plan usage with pacing, context and cache state.
// Claude Code passes JSON on stdin (model, rate_limits, context_window, prompt_cache). Local only.
// Side effect: snapshots rate_limits to ~/.claude/usage-max/limits.json so /usage-max check can use real numbers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pace } from "./lib.mjs";
import { aboveCeiling } from "./ceiling.mjs";
import { writeAtomic } from "./safefile.mjs";

const home = process.env.USAGE_MAX_HOME || os.homedir();
const dataDir = path.join(home, ".claude", "usage-max");
const statusPath = process.env.USAGE_MAX_STATUS_PATH || path.join(dataDir, "status.json");
const limitsPath = process.env.USAGE_MAX_LIMITS_PATH || path.join(dataDir, "limits.json");

function compact(value) {
  const n = Number(value) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}
function hrs(h) {
  if (h === null || h === undefined) return "?";
  return h >= 48 ? `${(h / 24).toFixed(1)}d` : `${h.toFixed(h < 10 ? 1 : 0)}h`;
}

let input = {};
try { const raw = await readStdin(); input = raw ? JSON.parse(raw) : {}; } catch { input = {}; }

let modelId = process.env.USAGE_MAX_MODEL || (input.model && (input.model.id || input.model.display_name)) || "";
let label = process.env.USAGE_MAX_MODEL || (input.model && (input.model.display_name || input.model.id)) || "";
if (!modelId) {
  try { const s = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8")); modelId = label = s.model || "default"; } catch { modelId = label = "default"; }
}
const parts = [`${label}${aboveCeiling(modelId) ? " ⚠ ABOVE OPUS 5.5 CEILING" : ""}`];
let gov = null;
try { gov = JSON.parse(fs.readFileSync(path.join(dataDir, "governor.json"), "utf8")); } catch {}
const govAgeH = gov && gov.last && gov.last.at && Number.isFinite(Date.parse(gov.last.at)) ? (Date.now() - Date.parse(gov.last.at)) / 3600000 : null;
const govOld = govAgeH !== null && govAgeH > 6 && !(gov && gov.override) ? ` (as of ${govAgeH >= 48 ? Math.round(govAgeH / 24) + "d" : Math.round(govAgeH) + "h"} ago)` : "";
if (gov && gov.mode) parts.push(`budget ${gov.mode.toUpperCase()}${gov.override ? " (pinned)" : ""}${govOld}${gov.last && gov.last.note ? " (plan % unknown until your next reply)" : ""}`);

const rl = input.rate_limits || null;
if (rl && (rl.seven_day || rl.five_hour)) {
  try { // atomic: the governor reads this file while the next render may be writing it. A window the reading lacks stays null (an old value must not look new).
    writeAtomic(limitsPath, JSON.stringify({ capturedAt: new Date().toISOString(), five_hour: rl.five_hour || null, seven_day: rl.seven_day || null }));
  } catch (e) { process.exitCode = 0; }
  const early = (p) => p.elapsed < 0.1 && p.used < 95; // a projection from the first tenth of a window is noise (the budget logic ignores it too)
  const wk = pace(rl.seven_day, 7 * 24 * 3600);
  if (wk) {
    let s = `wk ${Math.round(wk.used)}%`;
    if (wk.state === "over" && !early(wk)) s += ` ⚠ cap in ${hrs(wk.capInHours)} (resets ${hrs(wk.hoursLeft)})`;
    else if (wk.state === "under") s += ` → ~${Math.round(wk.projected)}% at reset: ${Math.round(100 - wk.projected)}% unused, spend more`;
    else if (wk.projected !== null) s += ` → ~${Math.round(Math.min(wk.projected, 100))}% at reset, on pace`;
    parts.push(s);
  }
  const fh = pace(rl.five_hour, 5 * 3600);
  if (fh) parts.push(`5h ${Math.round(fh.used)}%${fh.state === "over" && !early(fh) ? ` ⚠ cap in ${hrs(fh.capInHours)}` : ""}`);
} else {
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    const ageH = (Date.now() - fs.statSync(statusPath).mtimeMs) / 3600000; // a summary from weeks ago is not "current": fall through to the governor estimate
    if (ageH > 24) throw new Error("status.json is stale");
    parts.push(`${compact(status.contextPerDay)}/day · opus ${status.opusTurns || 0}${ageH > 2 ? ` (as of ${Math.round(ageH)}h ago)` : ""}`);
  } catch {
    const est = gov && gov.last && Number.isFinite(gov.last.estPct) ? `wk ~${Math.round(gov.last.estPct)}% (est.)` : "no plan data yet (appears after first reply)";
    parts.push(est);
  }
}
const cw = input.context_window;
if (cw && typeof cw.used_percentage === "number") parts.push(`ctx ${Math.round(cw.used_percentage)}%`);
const pc = input.prompt_cache;
if (pc && typeof pc.warm === "boolean" && !pc.warm) parts.push("cache cold");
console.log(`usage-max ${parts.join(" · ")}`);
