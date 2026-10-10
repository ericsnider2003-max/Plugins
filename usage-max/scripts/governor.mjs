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
import { dataDir, readJson, writeJsonAtomic, loadMeter, saveMeter, spendInLast, bootstrap } from "./meter.mjs";

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
    red: { model: "claude-sonnet-5-5", effort: "low" }
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
  return readJson(files().state, { mode: "green", override: null, calib: null, k: null, sessionsNotified: {}, history: [] });
}
export function saveState(s) {
  const keys = Object.keys(s.sessionsNotified || {});
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete s.sessionsNotified[k];
  s.history = (s.history || []).slice(-50);
  writeJsonAtomic(files().state, s);
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

// Fold a newer real snapshot (from the status line) into the calibration; refine k from the delta.
export function absorbSnapshot(state, limits, meterCum) {
  const sd = limits && limits.seven_day;
  if (!sd || typeof sd.used_percentage !== "number" || !sd.resets_at) return false;
  const at = Date.parse(limits.capturedAt) || Date.now();
  const c = state.calib;
  if (c && c.at >= at) return false;
  if (c && c.resetsAt === sd.resets_at && state.k) {
    const dPct = sd.used_percentage - c.pct;
    const dSpend = meterCum - c.cumAt;
    if (dSpend > 2 && dPct > 0) state.k = 0.7 * state.k + 0.3 * (dPct / dSpend); // smoothed
  }
  state.calib = { pct: sd.used_percentage, at, cumAt: meterCum, resetsAt: sd.resets_at, source: "plan" };
  return true;
}

export function estimate(state, meter, nowMs = Date.now(), config = DEFAULT_CONFIG) {
  const c = state.calib;
  if (!c || !state.k) return { estPct: null, hoursLeft: null, ratePerHour: null };
  if (c.resetsAt * 1000 <= nowMs) return { estPct: 0, hoursLeft: 168, ratePerHour: 0, note: "window reset — waiting for a fresh snapshot" };
  const estPct = c.pct + state.k * Math.max(meter.cum - c.cumAt, 0);
  const hoursLeft = (c.resetsAt * 1000 - nowMs) / 3600000;
  const ratePerHour = (state.k * spendInLast(meter, config.burnWindowHours, nowMs)) / config.burnWindowHours;
  return { estPct, hoursLeft, ratePerHour };
}

// Write the mode's model/effort into user settings (new sessions only). Owned keys only.
export function applySettings(mode, config) {
  if (!config.manageSettings) return false;
  const want = config.modes[mode];
  if (!want) return false;
  const file = files().settings;
  const s = readJson(file, null);
  if (!s) return false;
  const before = JSON.stringify([s.model, s.effortLevel, s.modelSettings]);
  s.model = want.model;
  s.effortLevel = want.effort;
  s.modelSettings = { ...(s.modelSettings || {}) };
  for (const m of ["claude-opus-5-5", "claude-sonnet-5-5"]) s.modelSettings[m] = { ...(s.modelSettings[m] || {}), effortLevel: want.effort };
  if (JSON.stringify([s.model, s.effortLevel, s.modelSettings]) === before) return false;
  writeJsonAtomic(file, s);
  return true;
}

// One evaluation pass: absorb snapshot, estimate, decide, enforce on change. Returns the new state.
export function evaluate({ meter, nowMs = Date.now() } = {}) {
  const config = loadConfig();
  const state = loadState();
  meter = meter || loadMeter();
  absorbSnapshot(state, readJson(files().limits, null), meter.cum);
  const est = estimate(state, meter, nowMs, config);
  const d = state.override ? { mode: state.override, ratio: null, allowedPerHour: null } : decide({ ...est, prevMode: state.mode, config });
  const changed = d.mode !== state.mode;
  state.last = { at: new Date(nowMs).toISOString(), ...est, ...d };
  if (changed) {
    state.history.push({ at: state.last.at, from: state.mode, to: d.mode, estPct: est.estPct, ratio: d.ratio });
    state.mode = d.mode;
    state.changedAt = state.last.at;
  }
  if (changed || state.appliedMode !== state.mode) {
    try { applySettings(state.mode, config); state.appliedMode = state.mode; } catch {}
  }
  saveState(state);
  return state;
}

function fmt(n, d = 1) { return n === null || n === undefined || !Number.isFinite(n) ? "n/a" : n.toFixed(d); }

async function cli() {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const flag = (n) => { const i = rest.indexOf(`--${n}`); return i > -1 ? rest[i + 1] : null; };
  const config = loadConfig();
  if (cmd === "calibrate") {
    const pct = Number(rest[0]);
    if (!Number.isFinite(pct)) { console.log("usage: calibrate <weekly % from Settings > Usage> [--resets <ISO date or epoch seconds>]"); process.exit(1); }
    let resetsAt = flag("resets");
    if (resetsAt) resetsAt = /^\d+$/.test(resetsAt) ? Number(resetsAt) : Math.floor(Date.parse(resetsAt) / 1000);
    const lim = readJson(files().limits, null);
    if (!resetsAt && lim && lim.seven_day && lim.seven_day.resets_at * 1000 > Date.now()) resetsAt = lim.seven_day.resets_at;
    if (!resetsAt) { console.log("need --resets <when the weekly limit resets> (shown in Settings > Usage)"); process.exit(1); }
    const projects = flag("projects-dir") || path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".claude", "projects");
    const { meter, windowSpend } = await bootstrap(projects, resetsAt * 1000 - 7 * 86400000);
    if (windowSpend <= 0) { console.log("no local spend found in this window; cannot derive k"); process.exit(1); }
    saveMeter(meter);
    const state = loadState();
    state.k = pct / windowSpend;
    state.calib = { pct, at: Date.now(), cumAt: 0, resetsAt, source: "manual" };
    saveState(state);
    console.log(`calibrated: ${pct}% of the week = $${windowSpend.toFixed(2)} local list-price spend → k=${state.k.toFixed(4)} %/$ (resets ${new Date(resetsAt * 1000).toString()})`);
  } else if (cmd === "mode") {
    const m = rest[0];
    if (!["auto", "green", "amber", "red"].includes(m)) { console.log("usage: mode <auto|green|amber|red>"); process.exit(1); }
    const state = loadState();
    state.override = m === "auto" ? null : m;
    saveState(state);
    console.log(m === "auto" ? "mode override cleared (automatic)" : `mode pinned to ${m} until 'mode auto'`);
  }
  const s = evaluate();
  const l = s.last || {};
  const want = config.modes[s.mode];
  console.log(`usage-max budget: ${s.mode.toUpperCase()}${s.override ? " (pinned)" : ""}`);
  console.log(`  week ~${fmt(l.estPct)}% (est.), ${fmt(l.hoursLeft, 0)}h to reset, target ${config.target}%`);
  console.log(`  burn ${fmt(l.ratePerHour, 2)}%/h over last ${config.burnWindowHours}h vs sustainable ${fmt(l.allowedPerHour, 2)}%/h → ${fmt(l.ratio, 2)}× ${l.ratio > 1 ? "(over)" : "(ok)"}`);
  console.log(`  new sessions: ${want.model} @ ${want.effort} effort${config.manageSettings ? "" : " (settings management OFF)"}`);
  console.log(`  calibration: ${s.calib ? `${s.calib.pct}% at ${new Date(s.calib.at).toLocaleString()} (${s.calib.source}), k=${fmt(s.k, 4)} %/$` : "none — run: calibrate <pct> --resets <date>"}`);
  if (cmd === "gate") process.exitCode = { green: 0, amber: 10, red: 20 }[s.mode];
  if ((s.history || []).length) console.log(`  last change: ${s.history[s.history.length - 1].from} → ${s.history[s.history.length - 1].to} at ${s.history[s.history.length - 1].at}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await cli();
}
