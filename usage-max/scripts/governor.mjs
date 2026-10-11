#!/usr/bin/env node
// Budget governor: keeps the weekly plan from hitting 100% before reset while work continues.
//   estimate  = last real plan % + k × (metered spend since then)   [k = plan % per $ at list price]
//   mode      = burn rate vs sustainable rate to reach `target`% exactly at reset
//   enforce   = settings for NEW sessions (model/effort), Agent model downgrades, prompt directives,
//               model-switch guard. Running sessions keep their model/effort (read at start only).
// gate: exit code 0 green / 10 amber / 20 red, for batch & eval harnesses.
// CLI: status | gate | calibrate <pct> [--resets <ISO|epoch>] | mode <auto|green|amber|red> | apply
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pace } from "./lib.mjs";
import { writeSelf } from "./shared.mjs";
import { ownedSet, ownedUnset, loadApplied, saveApplied } from "./owned.mjs";
import { dataDir, readJson, writeJsonAtomic, loadMeter, saveMeter, spendInLast, bootstrap, writeFailures } from "./meter.mjs";

export const DEFAULT_CONFIG = {
  target: 98,
  burnWindowHours: 12,
  amberRatio: 1.0,
  redRatio: 1.5,
  redAtPercent: 92,
  manageSettings: true,
  modes: {
    green: { model: "claude-opus-5-5", effort: "medium" },
    amber: { model: "claude-opus-5-5", effort: "low" },
    red: { model: "claude-sonnet-5-5", effort: "low" },
    surplus: { model: "claude-opus-5-5", effort: "high", otherEffort: "medium" } // green + allowance going unused: room for harder thinking
  }
};
const files = () => ({
  config: path.join(dataDir(), "config.json"),
  state: path.join(dataDir(), "governor.json"),
  limits: process.env.USAGE_MAX_LIMITS_PATH || path.join(dataDir(), "limits.json"),
  settings: path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".claude", "settings.json")
});

export function loadConfig() {
  const c = readJson(files().config, {});
  return { ...DEFAULT_CONFIG, ...c, modes: { ...DEFAULT_CONFIG.modes, ...(c.modes || {}) } };
}
export function loadState() {
  const defaults = { mode: "green", override: null, calib: null, k: null, sessionsNotified: {}, history: [] };
  const s = readJson(files().state, null);
  return s && typeof s === "object" ? { ...defaults, ...s, sessionsNotified: s.sessionsNotified || {}, history: s.history || [] } : defaults;
}
export function saveState(s) {
  const keys = Object.keys(s.sessionsNotified || {});
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete s.sessionsNotified[k];
  s.history = (s.history || []).slice(-50);
  try { writeJsonAtomic(files().state, s); } catch (e) { writeFailures.push(`governor.json: ${e.code || e.message}`); } // read-only sandbox: keep going
}

// Pure decision function (tested).
export function decide({ estPct, hoursLeft, ratePerHour, prevMode, config }) {
  const c = config || DEFAULT_CONFIG;
  if (estPct === null || hoursLeft === null) return { mode: prevMode || "green", ratio: null, allowedPerHour: null, reason: "no calibration" };
  const remaining = c.target - estPct;
  const allowedPerHour = hoursLeft > 0 ? remaining / hoursLeft : 0;
  const ratio = allowedPerHour > 0 ? ratePerHour / allowedPerHour : Infinity;
  let mode;
  if (estPct >= c.redAtPercent && hoursLeft > 6) mode = "red";
  else if (remaining <= 0) mode = "red";
  else if (ratio > c.redRatio) mode = "red";
  else if (ratio > c.amberRatio) mode = "amber";
  else mode = "green";
  // Hysteresis: only relax one level, and only with 10% margin, to avoid flapping.
  const rank = { green: 0, amber: 1, red: 2 };
  if (prevMode && rank[mode] < rank[prevMode]) {
    const relaxTo = prevMode === "red" ? "amber" : "green";
    const threshold = prevMode === "red" ? c.redRatio : c.amberRatio;
    mode = ratio < threshold * 0.9 && !(prevMode === "red" && estPct >= c.redAtPercent) ? relaxTo : prevMode;
  }
  return { mode, ratio, allowedPerHour, remaining };
}

// Fold a newer real snapshot (from the status line) into the calibration. Keeps a small (time, pct) history so the
// burn rate can come from the plan's own percentages (which include Cowork/chat), and learns k (plan % per $ of
// local spend) from real deltas instead of needing a manual `calibrate`.
export function absorbSnapshot(state, limits, meterCum) {
  const sd = limits && limits.seven_day;
  if (!sd || typeof sd.used_percentage !== "number" || !sd.resets_at) return false;
  const at = Date.parse(limits.capturedAt);
  if (!Number.isFinite(at)) return false; // no timestamp = cannot tell how old it is: never treat as fresh
  const c = state.calib;
  if (c && c.at >= at) return false;
  state.snaps = (state.snaps || []).filter((x) => x.resetsAt === sd.resets_at).slice(-199);
  const last = state.snaps[state.snaps.length - 1];
  if (!last || at - last.at >= 5 * 60000 || sd.used_percentage !== last.pct) state.snaps.push({ at, pct: sd.used_percentage, resetsAt: sd.resets_at });
  if (c && c.resetsAt === sd.resets_at) {
    const dPct = sd.used_percentage - c.pct;
    const dSpend = meterCum - c.cumAt;
    if (dSpend > 0.25 && dPct > 0) state.k = state.k ? 0.7 * state.k + 0.3 * (dPct / dSpend) : dPct / dSpend;
  }
  state.calib = { pct: sd.used_percentage, at, cumAt: meterCum, resetsAt: sd.resets_at, source: "plan" };
  return true;
}

// The plan window rolls over every 7 days. When the calibrated reset has passed and no fresh status-line
// snapshot has arrived, start the next window at 0% (spend before the reset no longer counts) instead of
// carrying last week's percentage. Returns true when it rolled.
export function rollWindow(state, meter, nowMs = Date.now()) {
  const c = state.calib;
  if (!c || !c.resetsAt || c.resetsAt * 1000 > nowMs) return false;
  const WEEK = 7 * 86400000;
  const nextReset = c.resetsAt * 1000 + (Math.floor((nowMs - c.resetsAt * 1000) / WEEK) + 1) * WEEK;
  const windowStart = nextReset - WEEK;
  const spentSince = spendInLast(meter, Math.max((nowMs - windowStart) / 3600000, 0), nowMs);
  state.calib = { pct: 0, at: windowStart, cumAt: Math.max(meter.cum - spentSince, 0), resetsAt: Math.floor(nextReset / 1000), source: "rolled" };
  return true;
}

export function estimate(state, meter, nowMs = Date.now(), config = DEFAULT_CONFIG) {
  const c = state.calib;
  if (!c) return { estPct: null, hoursLeft: null, ratePerHour: null };
  if (c.resetsAt * 1000 <= nowMs) return { estPct: 0, hoursLeft: 168, ratePerHour: 0, note: "window reset — waiting for a fresh snapshot" };
  const estPct = c.pct + (state.k ? state.k * Math.max(meter.cum - c.cumAt, 0) : 0);
  const hoursLeft = (c.resetsAt * 1000 - nowMs) / 3600000;
  // Prefer the plan's own percentages: gain over the burn window, divided by the time since the window's first point.
  const win = (state.snaps || []).filter((x) => x.resetsAt === c.resetsAt && x.at >= nowMs - config.burnWindowHours * 3600000);
  let ratePerHour = null, rateSource = null;
  if (win.length >= 2 && win[win.length - 1].at - win[0].at >= 1800000) {
    ratePerHour = Math.max(0, (win[win.length - 1].pct - win[0].pct) / Math.max((nowMs - win[0].at) / 3600000, 0.5));
    rateSource = "plan %";
  } else {
    // Only one reading: use your AVERAGE pace since the week began (plan % / elapsed hours). It needs no local data and cannot be
    // inflated by usage that happens elsewhere (Cowork, chat, other devices) the way a local-spend scale factor can.
    const elapsedH = Math.max(168 - hoursLeft, 6);
    ratePerHour = c.pct / elapsedH;
    rateSource = "average so far";
  }
  return { estPct, hoursLeft, ratePerHour: ratePerHour === null ? 0 : ratePerHour, rateSource: rateSource || "none yet" };
}


// Set the mode's model/effort on a settings object. Respects ownership: a model/effort the USER set is kept.
// Returns true when something changed.
export function patchModel(s, want, applied = {}, force = false) {
  let changed = false;
  const set = (k, v) => { if (ownedSet(s, k, v, applied, force) === "set") changed = true; };
  set("model", want.model);
  set("effortLevel", want.effort);
  // `otherEffort` lets surplus raise only the hub model while subagent models stay economical.
  for (const m of ["claude-opus-5-5", "claude-sonnet-5-5"]) set(`modelSettings.${m}.effortLevel`, m === want.model || !want.otherEffort ? want.effort : want.otherEffort);
  return changed;
}

// Lean mode: while tightening (AMBER/RED) also cap context growth, drop always-on thinking and switch off background spend
// (auto memory; RED also scheduled tasks). GREEN hands the user's own values back.
// "Unused allowance" only means something near the end of the window; right after a reset everything looks unused.
export const SURPLUS_WITHIN_H = 72;
export const LEAN = {
  amber: { autoCompactWindow: 160000, "env.CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1" },
  red: { autoCompactWindow: 120000, alwaysThinkingEnabled: false, "env.CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1", "env.CLAUDE_CODE_DISABLE_CRON": "1" }
};
const LEAN_KEYS = ["autoCompactWindow", "alwaysThinkingEnabled", "env.CLAUDE_CODE_DISABLE_AUTO_MEMORY", "env.CLAUDE_CODE_DISABLE_CRON"];
export function patchLean(s, mode, applied = {}) {
  let changed = false; const want = LEAN[mode] || {};
  for (const k of LEAN_KEYS) {
    if (k in want) { if (ownedSet(s, k, want[k], applied, true) === "set") changed = true; }
    else if (ownedUnset(s, k, applied)) changed = true; // still ours: remove it; a user-changed value is kept
  }
  return changed;
}
// Hours until the plan hits 100% at the current burn, only from real data and only when that happens before the reset.
export function timeToEmpty(l) {
  if (!l || l.estPct == null || !(l.ratePerHour > 0) || l.hoursLeft == null || l.rateSource === "none yet") return null;
  const h = (100 - l.estPct) / l.ratePerHour;
  return h < l.hoursLeft ? { hours: Math.max(h, 0), resetIn: l.hoursLeft } : null;
}

// Write the mode's model/effort into user settings (new sessions only). Returns true (changed), false
// (already right / management off) or null (no settings.json yet: nothing was applied; profile.mjs creates it).
export function applySettings(mode, config) {
  if (!config.manageSettings) return false;
  const want = config.modes[mode];
  if (!want) return false;
  const file = files().settings;
  const s = readJson(file, null);
  if (!s) return null;
  const af = path.join(dataDir(), "applied.json"), applied = loadApplied(af);
  const c1 = patchModel(s, want, applied, mode === "amber" || mode === "red"); // tightening may override your values; green hands back to them
  const changed = patchLean(s, mode, applied) || c1;
  saveApplied(af, applied);
  if (!changed) return false;
  writeJsonAtomic(file, s);
  return true;
}

// One evaluation pass: absorb snapshot, estimate, decide, enforce on change. Returns the new state.
export function evaluate({ meter, nowMs = Date.now() } = {}) {
  const config = loadConfig();
  const state = loadState();
  meter = meter || loadMeter();
  absorbSnapshot(state, readJson(files().limits, null), meter.cum);
  if (rollWindow(state, meter, nowMs)) state.mode = "green"; // new week: no hysteresis from last week's mode
  const est = estimate(state, meter, nowMs, config);
  let d = state.override ? { mode: state.override, ratio: null, allowedPerHour: null } : decide({ ...est, prevMode: state.mode, config });
  // The 5-hour cap bites before the weekly one: near it, tighten regardless of the weekly pace.
  // Pace-aware: a high % near the end of a window that is about to reset costs nothing, so only tighten when the
  // current burn would hit 100% before the window resets (amber), or is far beyond it (red).
  const lim5 = !state.override ? readJson(files().limits, null) || {} : {};
  const fh = lim5.five_hour && nowMs - Date.parse(lim5.capturedAt) < 20 * 60000 ? lim5.five_hour : null; // stale snapshot = no signal
  const fp = fh && fh.resets_at * 1000 > nowMs ? pace(fh, 5 * 3600, nowMs) : null;
  if (fp && fp.state === "over") {
    const rank = { green: 0, amber: 1, red: 2 };
    const floor = fp.used >= 95 || fp.projected > 140 ? "red" : "amber";
    if (rank[floor] > rank[d.mode]) d = { ...d, mode: floor, reason: `5-hour window ${Math.round(fp.used)}%, projected ${Math.round(fp.projected)}%` };
  }
  const changed = d.mode !== state.mode;
  state.last = { at: new Date(nowMs).toISOString(), ...est, ...d };
  if (changed) {
    state.history.push({ at: state.last.at, from: state.mode, to: d.mode, estPct: est.estPct, ratio: d.ratio });
    state.mode = d.mode;
    state.changedAt = state.last.at;
  }
  // Surplus: the week is on course to leave >20% unused, so allow higher effort. Hysteresis 80/90, never in amber/red.
  const projected = est.estPct === null ? null : est.estPct + (est.ratePerHour || 0) * (est.hoursLeft || 0);
  const lastSnap = (state.snaps || [])[(state.snaps || []).length - 1];
  const haveRealRate = est.rateSource === "plan %" && lastSnap && nowMs - lastSnap.at < 2 * 3600e3; // no data / silent status line = no surplus
  if (state.mode !== "green" || projected === null || est.hoursLeft <= 12 || est.hoursLeft > SURPLUS_WITHIN_H || !haveRealRate || est.note) state.surplus = false;
  else if (!state.surplus && projected < 80) state.surplus = true;
  else if (state.surplus && projected > 90) state.surplus = false;
  state.last.projected = projected;
  const key = state.mode === "green" && state.surplus ? "surplus" : state.mode;
  if (changed || state.appliedKey !== key) {
    try { if (applySettings(key, config) !== null) { state.appliedKey = key; state.appliedMode = state.mode; } } catch {}
  }
  const fp5 = (readJson(files().limits, null) || {}).five_hour;
  writeSelf("claude", { mode: state.mode, surplus: Boolean(state.surplus), estPct: est.estPct, hoursLeft: est.hoursLeft, fivePct: fp5 && typeof fp5.used_percentage === "number" ? fp5.used_percentage : null });
  saveState(state);
  return state;
}

function fmt(n, d = 1) { return n === null || n === undefined || !Number.isFinite(n) ? "n/a" : n.toFixed(d); }

async function cli() {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const flag = (n) => { const i = rest.indexOf(`--${n}`); return i > -1 ? rest[i + 1] : null; };
  const config = loadConfig();
  if (cmd === "calibrate") {
    const pct = Number(String(rest[0] || "").replace(/%/g, "").trim());
    if (!Number.isFinite(pct)) { console.log("usage: calibrate <weekly % from Settings > Usage> [--resets <ISO date or epoch seconds>]"); process.exit(1); }
    let resetsAt = flag("resets");
    if (resetsAt) resetsAt = /^\d+$/.test(resetsAt) ? Number(resetsAt) : Math.floor(Date.parse(resetsAt) / 1000);
    const lim = readJson(files().limits, null);
    if (!resetsAt && lim && lim.seven_day && lim.seven_day.resets_at * 1000 > Date.now()) resetsAt = lim.seven_day.resets_at;
    if (!resetsAt) { console.log("need --resets <when the weekly limit resets> (shown in Settings > Usage)"); process.exit(1); }
    const projects = flag("projects-dir") || path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".claude", "projects");
    const { meter, windowSpend } = await bootstrap(projects, resetsAt * 1000 - 7 * 86400000);
    const state = loadState();
    const now = Date.now();
    // Every manual reading also becomes a plan-% snapshot, so two readings a few hours apart give a real burn rate.
    state.snaps = [...(state.snaps || []).filter((x) => x.resetsAt === resetsAt).slice(-199), { at: now, pct, resetsAt }];
    if (windowSpend > 0) {
      saveMeter(meter);
      state.k = pct / windowSpend;
      state.calib = { pct, at: now, cumAt: 0, resetsAt, source: "manual" };
      saveState(state);
      console.log(`calibrated: ${pct}% of the week = $${windowSpend.toFixed(2)} local list-price spend → k=${state.k.toFixed(4)} %/$ (resets ${new Date(resetsAt * 1000).toString()})`);
    } else {
      // No local Claude Code history here (cloud/desktop sessions). Still useful: remember the reading and the reset time.
      state.calib = { pct, at: now, cumAt: loadMeter().cum || 0, resetsAt, source: "manual" };
      saveState(state);
      console.log(`saved: ${pct}% used, resets ${new Date(resetsAt * 1000).toString()}. There is no local usage history on this machine, so the estimate will not grow between readings: re-run this whenever you look at Settings > Usage (two readings a few hours apart also give a real burn rate).`);
    }
  } else if (cmd === "mode") {
    const m = rest[0];
    if (!["auto", "green", "amber", "red"].includes(m)) { console.log("usage: mode <auto|green|amber|red>"); process.exit(1); }
    const state = loadState();
    state.override = m === "auto" ? null : m;
    saveState(state);
    console.log(m === "auto" ? "mode override cleared (automatic)" : `mode pinned to ${m} until 'mode auto'`);
  }
  const s = evaluate();
  if ((cmd === "calibrate" || cmd === "mode") && writeFailures.length) { console.error(`could not save (${writeFailures.join(", ")}): this shell is read-only. Run the same command from a normal terminal.`); process.exit(1); }
  if (writeFailures.length) console.log(`note: could not save state (${[...new Set(writeFailures)].join(", ")}) because this shell is read-only (a sandbox). Numbers are computed live; saved state is unchanged.`);
  const l = s.last || {};
  const want = config.modes[s.mode === "green" && s.surplus ? "surplus" : s.mode];
  console.log(`usage-max budget: ${s.mode.toUpperCase()}${s.surplus ? "+SURPLUS" : ""}${s.override ? " (pinned)" : ""}`);
  if (s.surplus) console.log(`  surplus: projected ~${fmt(l.projected, 0)}% at reset — ~${fmt(100 - l.projected, 0)}% of the week would go unused, so higher effort is allowed on hard problems`);
  const tte = timeToEmpty(l);
  if (tte) console.log(`  WARNING: at this pace the plan runs out in ~${fmt(tte.hours, 0)}h, but it resets in ${fmt(tte.resetIn, 0)}h`);
  console.log(`  week ~${fmt(l.estPct)}% (est.), ${fmt(l.hoursLeft, 0)}h to reset, target ${config.target}%`);
  console.log(`  burn ${fmt(l.ratePerHour, 2)}%/h over last ${config.burnWindowHours}h${l.rateSource ? ` (from ${l.rateSource})` : ""} vs sustainable ${fmt(l.allowedPerHour, 2)}%/h → ${fmt(l.ratio, 2)}× ${l.ratio > 1 ? "(over)" : "(ok)"}`);
  const hasSettings = fs.existsSync(files().settings);
  { // pace planner: what the plan can sustain per day, what you actually used lately, and allowance about to expire
    const sn = (s.snaps || []).filter((x) => x.resetsAt === (s.calib && s.calib.resetsAt));
    const dayAgo = Date.now() - 24 * 3600e3, base = sn.find((x) => x.at >= dayAgo) || sn[0], lastSn = sn[sn.length - 1];
    if (l.allowedPerHour != null && Number.isFinite(l.allowedPerHour)) {
      const used = base && lastSn && lastSn.at - base.at >= 3600e3 ? `${fmt(((lastSn.pct - base.pct) * 24 * 3600e3) / (lastSn.at - base.at), 1)}%/day recently` : "not enough history yet";
      console.log(`  pace: ${fmt(l.allowedPerHour * 24, 1)}%/day keeps you at ${config.target}% by reset; you are at ${used}`);
    }
    if (l.hoursLeft != null && l.hoursLeft <= 24 && l.projected != null && l.projected < 95) console.log(`  use it or lose it: ~${fmt(100 - l.projected, 0)}% of the week expires in ${fmt(l.hoursLeft, 0)}h — queue the heavy work now`);
  }
  console.log(`  new sessions: ${want.model} @ ${want.effort} effort${config.manageSettings ? "" : " (settings management OFF)"}${config.manageSettings && !hasSettings ? (process.env.CLAUDE_CODE_REMOTE === "true" ? " (cloud session: this machine starts blank, so the settings profile does not apply here; it applies on your PC)" : " — NOT APPLIED: ~/.claude/settings.json is missing; run usage-max rescue apply --write") : ""}`);
  console.log(`  calibration: ${s.calib ? `${s.calib.pct}% at ${new Date(s.calib.at).toLocaleString()} (${s.calib.source}), k=${fmt(s.k, 4)} %/$` : "none — run: calibrate <pct> --resets <date>"}`);
  if (cmd === "gate") process.exitCode = { green: 0, amber: 10, red: 20 }[s.mode];
  if ((s.history || []).length) console.log(`  last change: ${s.history[s.history.length - 1].from} → ${s.history[s.history.length - 1].to} at ${s.history[s.history.length - 1].at}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await cli();
}
