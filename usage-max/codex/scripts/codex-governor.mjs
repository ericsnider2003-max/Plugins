#!/usr/bin/env node
// usage-max for OpenAI Codex CLI: meter ~/.codex sessions, estimate plan %, pick mode, write profiles.
// CLI: doctor | selftest-trim | savings [--days N --since ISO --json] | backup [--out dir] | restore --check <dir> | restore <dir> --apply | models | status | calibrate <pct> --resets <ISO> | mode <auto|green|amber|red> | apply | profiles | gate
// gate exit codes: 0 green, 10 amber, 20 red (for batch/eval harnesses: skip or defer work on 20).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { binDir } from "./sync.mjs";
import { editText } from "./safefile.mjs";
import { writeSelf, readOther, isFresh } from "./shared.mjs";

export const HOME = () => process.env.USAGE_MAX_HOME || os.homedir();
export const codexHome = () => process.env.CODEX_HOME || path.join(HOME(), ".codex");
export const dataDir = () => path.join(HOME(), ".usage-max-codex");
const j = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
// Codex runs shell commands the model starts in a sandbox that may forbid writing outside the workspace (EPERM). Reading and
// computing still work, so never crash: remember the failure and say so plainly (hooks run on the host and CAN save).
export const writeFailures = [];
const wj = (f, v) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + ".tmp"; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, f); return true; } catch (e) { writeFailures.push(`${path.basename(f)}: ${e.code || e.message}`); return false; } };

// Relative cost weights per model family (only ratios matter; k calibrates to plan %). From Plus 5h message ratios.
export const DEFAULT_CONFIG = {
  target: 98, burnWindowHours: 12, amberRatio: 1.0, redRatio: 1.5, redAtPercent: 92,
  weights: [["luna", 1], ["sol", 20], ["astra", 65], ["mini", 1], ["codex", 10], ["", 10]],
  modes: { // model null = leave your model untouched; the installer seeds config.json from models seen in sessions.
    green: { model: null, effort: "medium", service_tier: null },
    amber: { model: null, effort: "low", service_tier: null },
    red: { model: null, effort: "low", service_tier: null },
    surplus: { model: null, effort: "high", service_tier: null } // green + unused allowance
  },
  // SAFE BY DEFAULT: nothing here shrinks what Codex can see. (Earlier versions wrote tool_output_token_limit 8000, model_auto_compact_token_limit 64000
// and project_doc_max_bytes 16384 into config.toml: compaction at 64k tokens and AGENTS.md cut at 16 KB make Codex forget parts of a project.)
// Set a number under "tuning" in config.json only if you want that limit managed; null/absent = untouched. LEGACY_TUNING are the old defaults we remove.
tuning: { tool_output_token_limit: null, model_auto_compact_token_limit: null, project_doc_max_bytes: null }
};
export const loadConfig = () => { const c = j(path.join(dataDir(), "config.json"), {}); return { ...DEFAULT_CONFIG, ...c, modes: { ...DEFAULT_CONFIG.modes, ...c.modes }, tuning: { ...DEFAULT_CONFIG.tuning, ...c.tuning } }; };
export const weightFor = (model, cfg = DEFAULT_CONFIG) => { const m = String(model || "").toLowerCase(); for (const [k, w] of cfg.weights) if (m.includes(k)) return w; return 10; };

export function* walk(dir) { let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory()) yield* walk(p); else if (/rollout-.*\.jsonl$/.test(e.name)) yield p; } }

// Tolerant parse: token_count events (last_token_usage) priced by the model in the latest turn_context/session_meta.
export function scanFile(file, offset, cfg, model0 = null) {
  const buf = fs.readFileSync(file); if (offset > buf.length) offset = 0;
  const text = buf.subarray(offset).toString("utf8"); const end = text.lastIndexOf("\n"); if (end < 0) return { items: [], offset, limits: null, model: model0 };
  const items = []; let model = model0; let limits = null; // the model of the last turn carries over a scan boundary
  for (const line of text.slice(0, end).split("\n")) {
    if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; }
    const p = o.payload || o;
    if (p.model && (o.type === "turn_context" || o.type === "session_meta" || p.type === "turn_context")) model = p.model;
    if (p.type === "token_count" || o.type === "token_count") { // Codex logs the plan's real rate limits on every token_count event
      const rl = p.rate_limits || o.rate_limits;
      if (rl && (rl.primary || rl.secondary)) limits = { ts: Date.parse(o.timestamp || p.timestamp) || fs.statSync(file).mtimeMs, primary: rl.primary || null, secondary: rl.secondary || null };
    }
    if ((p.type === "token_count" || o.type === "token_count") && (p.info || p).last_token_usage) {
      const u = (p.info || p).last_token_usage; const ts = Date.parse(o.timestamp || p.timestamp) || fs.statSync(file).mtimeMs;
      const inp = u.input_tokens || 0, cached = u.cached_input_tokens || 0, out = (u.output_tokens || 0) + (u.reasoning_output_tokens && !u.output_tokens ? u.reasoning_output_tokens : 0);
      const cost = weightFor(model, cfg) * (Math.max(0, inp - cached) + 0.1 * cached + 5 * out) / 1e6;
      items.push({ ts, cost, model: model || "?" });
    }
  }
  return { items, limits, model, offset: offset + Buffer.byteLength(text.slice(0, end + 1)) };
}
export function loadMeter() { return j(path.join(dataDir(), "meter.json"), { files: {}, hours: {} }); }
export const METER_TTL_MS = 20e3;
export function meterAll(cfg = loadConfig(), nowMs = Date.now(), force = false) {
  const m = loadMeter(); if (!force && m.lastRun && nowMs - m.lastRun >= 0 && nowMs - m.lastRun < METER_TTL_MS) return m; const cut = nowMs - 8 * 864e5;
  for (const f of walk(path.join(codexHome(), "sessions"))) {
    let st; try { st = fs.statSync(f); } catch { continue; } if (st.mtimeMs < cut) continue;
    const prev = m.files[f] || { offset: 0, size: 0 }; if (st.size === prev.size) continue;
    const r = scanFile(f, prev.offset, cfg, prev.model || null); m.files[f] = { offset: r.offset, size: st.size, model: r.model };
    for (const it of r.items) { const h = Math.floor(it.ts / 36e5); m.hours[h] = (m.hours[h] || 0) + it.cost; }
    if (r.limits && (!m.limits || r.limits.ts >= m.limits.ts)) m.limits = r.limits;
  }
  for (const h of Object.keys(m.hours)) if (h < (nowMs - 8 * 864e5) / 36e5) delete m.hours[h];
  m.lastRun = nowMs; wj(path.join(dataDir(), "meter.json"), m); return m;
}
export const spendSince = (m, ms) => Object.entries(m.hours).reduce((a, [h, c]) => a + (h * 36e5 + 36e5 > ms ? c * Math.min(1, (h * 36e5 + 36e5 - ms) / 36e5) : 0), 0); // the hour that straddles `ms` counts only its later share
export const spendLast = (m, hrs, now = Date.now()) => spendSince(m, now - hrs * 36e5);

export function decide({ estPct, hoursLeft, ratePerHour, prevMode = "green", cfg }) {
  if (estPct >= cfg.redAtPercent && hoursLeft > 6) return "red";
  if (cfg.target - estPct <= 0) return "red";
  const sustain = Math.max(0, cfg.target - estPct) / Math.max(hoursLeft, 0.5);
  const ratio = sustain > 0 ? ratePerHour / sustain : Infinity;
  // hysteresis: a mode is left only when the ratio falls 10% below the level that entered it (entering red from amber needs the full red level)
  if (ratio >= cfg.redRatio * (prevMode === "red" ? 0.9 : 1)) return "red";
  if (ratio >= cfg.amberRatio * (prevMode === "green" ? 1 : 0.9)) return "amber";
  return "green";
}
export function estimate(state, m, now, cfg) {
  const c = state.calib; if (!c) return null;
  const P = 7 * 864e5; let rs = Date.parse(c.resets), at = c.at, pct = c.pct;
  if (rs <= now) { rs += (Math.floor((now - rs) / P) + 1) * P; at = rs - P; pct = 0; } // weekly reset passed: new window from prev reset, 0%
  const est = Math.min(100, pct + (state.k || 0) * spendSince(m, at));
  const hoursLeft = (rs - now) / 36e5;
  const from = Math.max(now - cfg.burnWindowHours * 36e5, rs - P); // spend before this window began is not this window's burn
  const rate = (state.k || 0) * spendSince(m, from) / Math.max((now - from) / 36e5, 1);
  return { est, hoursLeft, rate };
}
// Real plan numbers straight from Codex's own logs: the long window (>= ~7 days) calibrates the weekly estimate
// (no manual `calibrate` needed), the short window (<= ~10 h, the 5-hour cap) becomes an extra guard.
export function windows(limits) {
  const ws = [limits && limits.primary, limits && limits.secondary].filter((w) => w && typeof w.used_percent === "number" && w.window_minutes);
  return { weekly: ws.filter((w) => w.window_minutes >= 7000).sort((a, b) => b.window_minutes - a.window_minutes)[0] || null, short: ws.filter((w) => w.window_minutes <= 600).sort((a, b) => a.window_minutes - b.window_minutes)[0] || null };
}
export function absorbLimits(st, m, now) {
  const w = windows(m.limits); st.five = w.short ? { pct: w.short.used_percent, resetsAt: w.short.resets_at || null, windowMinutes: w.short.window_minutes, ts: m.limits.ts } : null;
  if (!w.weekly || !w.weekly.resets_at) return false;
  const at = m.limits.ts, resets = new Date(w.weekly.resets_at * 1000).toISOString(), c = st.calib;
  if (c && c.at >= at && c.source === "plan") return false;
  const sameWindow = c && Math.abs(Date.parse(c.resets) - w.weekly.resets_at * 1000) < 120000;
  if (sameWindow && c.at < at) { const d = spendSince(m, c.at) - spendSince(m, at), dp = w.weekly.used_percent - c.pct; if (spendSince(m, c.at) - spendSince(m, at) > 0 && dp > 0) st.k = st.k ? 0.7 * st.k + 0.3 * (dp / d) : dp / d; }
  if (!st.k) { const week = spendSince(m, w.weekly.resets_at * 1000 - 7 * 864e5); if (week > 0 && w.weekly.used_percent > 0) st.k = w.weekly.used_percent / week; }
  st.calib = { pct: w.weekly.used_percent, at, resets, source: "plan" }; return true;
}
// Pace-aware 5-hour guard: only tighten when the current burn would hit 100% before the window resets.
export function fiveFloor(f, now) {
  if (!f || !f.resetsAt || f.resetsAt * 1000 <= now) return "green";
  const win = (f.windowMinutes || 300) * 60000, start = f.resetsAt * 1000 - win, elapsed = Math.min(Math.max((now - start) / win, 0), 1);
  if (f.pct >= 95) return "red"; if (elapsed < 0.1) return "green"; // minutes into a window the projection is noise (same rule as the Claude side)
  const projected = f.pct / elapsed; if (projected <= 100) return "green";
  return projected > 140 && elapsed >= 0.25 ? "red" : "amber";
}
export function evaluate(now = Date.now(), force = false) {
  const cfg = loadConfig(); const sf = path.join(dataDir(), "governor.json");
  const st = j(sf, { mode: "green", override: null, calib: null, k: null }); const m = meterAll(cfg, now, force);
  absorbLimits(st, m, now);
  let mode = st.mode, e = estimate(st, m, now, cfg);
  if (st.override) mode = st.override; else {
    if (e) mode = decide({ estPct: e.est, hoursLeft: e.hoursLeft, ratePerHour: e.rate, prevMode: st.mode, cfg });
    const floor = fiveFloor(st.five, now); const rank = { green: 0, amber: 1, red: 2 }; if (rank[floor] > rank[mode]) mode = floor;
  }
  const fl = fiveFloor(st.five, now); let surplus = false;
  if (mode === "green" && e && fl === "green") { const proj = e.est + e.rate * e.hoursLeft; surplus = st.surplus ? !(proj > 90 || e.hoursLeft <= 12) : proj < 80 && e.hoursLeft > 12; e.projected = proj; }
  if (mode !== st.mode) { st.history = [...(Array.isArray(st.history) ? st.history : []), { at: new Date(now).toISOString(), from: st.mode, to: mode }].slice(-200); }
  st.mode = mode; st.surplus = surplus; st.appliedKey = st.appliedKey || null; wj(sf, st);
  try { writeSelf({ mode, surplus, estPct: e?.est ?? null, hoursLeft: e?.hoursLeft ?? null, fivePct: st.five?.pct ?? null, updatedAt: new Date(now).toISOString() }); } catch {}
  return { mode, surplus, e, st, cfg };
}
export function calibrate(pct, resets, now = Date.now()) {
  const cfg = loadConfig(); const sf = path.join(dataDir(), "governor.json"); const st = j(sf, {}); const m = meterAll(cfg, now, true);
  const start = st.calib ? st.calib.at : now - 7 * 864e5; const spend = spendSince(m, start);
  const newK = st.calib && spend > 0 ? Math.max(0, (pct - st.calib.pct) / spend) : (spendSince(m, Date.parse(resets) - 7 * 864e5) > 0 ? pct / spendSince(m, Date.parse(resets) - 7 * 864e5) : 0);
  st.k = st.k && newK ? 0.7 * newK + 0.3 * st.k : newK || st.k; st.calib = { pct, at: now, resets }; wj(sf, st); return st;
}

// ---- TOML: replace-or-insert top-level scalar keys (before first [table]), never touch other content.
export function setTopLevel(toml, kv) {
  const lines = toml.split("\n"); let firstTable = lines.findIndex(l => /^\s*\[/.test(l)); if (firstTable < 0) firstTable = lines.length;
  for (const [k, v] of Object.entries(kv)) {
    const val = v === null ? null : typeof v === "number" ? String(v) : JSON.stringify(v);
    const re = new RegExp("^\\s*" + k + "\\s*="); const i = lines.slice(0, firstTable).findIndex(l => re.test(l));
    if (val === null) { if (i >= 0) { lines.splice(i, 1); firstTable--; } continue; }
    if (i >= 0) lines[i] = `${k} = ${val}`; else { lines.splice(firstTable, 0, `${k} = ${val}`); firstTable++; }
  }
  return lines.join("\n");
}
export const LEGACY_TUNING = { tool_output_token_limit: 8000, model_auto_compact_token_limit: 64000, project_doc_max_bytes: 16384 };
const tuningKV = (cfg) => Object.fromEntries(Object.entries(cfg.tuning || {}).filter(([, v]) => Number.isFinite(v)));
const modeKV = (mc, cfg) => ({ ...(mc.model ? { model: mc.model } : {}), model_reasoning_effort: mc.effort, ...(mc.service_tier ? { service_tier: mc.service_tier } : {}), plan_mode_reasoning_effort: mc.effort === "low" ? "medium" : mc.effort, ...tuningKV(cfg) });
export function writeProfiles(cfg = loadConfig()) {
  for (const mode of ["green", "amber", "red", "surplus"]) {
    const f = path.join(codexHome(), `usage-max-${mode}.config.toml`);
    let t = ""; for (const [k, v] of Object.entries(modeKV(cfg.modes[mode], cfg))) if (v !== null) t += `${k} = ${typeof v === "number" ? v : JSON.stringify(v)}\n`;
    fs.mkdirSync(codexHome(), { recursive: true }); fs.writeFileSync(f, `# managed by usage-max (mode ${mode})\n` + t);
  }
}
export function markInstalled(now = Date.now()) { const sf = path.join(dataDir(), "governor.json"); const st = { mode: "green", override: null, calib: null, k: null, ...j(sf, {}) }; if (!st.installedAt) { st.installedAt = new Date(now).toISOString(); wj(sf, st); } }
export const modeKey = (mode, surplus) => mode + (surplus ? "+s" : "");
export function markApplied(key) { const sf = path.join(dataDir(), "governor.json"); const st = j(sf, {}); st.appliedKey = key; wj(sf, st); }
// Old defaults are removed ONLY when (a) usage-max once applied a mode on this machine (governor.json has appliedKey, i.e. it is the one that wrote them),
// (b) the line is a top-level key (above the first [table]) holding exactly the old default, and (c) you did not ask for that limit under "tuning".
const topLevel = (t) => { const i = String(t).search(/^\s*\[/m); return i < 0 ? String(t) : String(t).slice(0, i); };
export function legacyRemovals(text, cfg = loadConfig()) {
  const out = {}; const st = j(path.join(dataDir(), "governor.json"), {}); if (!st.appliedKey) return out;
  const head = topLevel(text);
  for (const [k, v] of Object.entries(LEGACY_TUNING)) { const m = head.match(new RegExp(`^\\s*${k}\\s*=\\s*(\\d+)\\s*(?:#.*)?$`, "m")); if (m && Number(m[1]) === v && !Number.isFinite((cfg.tuning || {})[k])) out[k] = null; }
  return out;
}
// Runs on every SessionStart: hand back the context-shrinking limits an older usage-max wrote, whatever the budget mode. Returns the keys removed.
export function cleanLegacy(cfg = loadConfig()) {
  try {
    const f = path.join(codexHome(), "config.toml"); let keys = [];
    const r = editText(f, (t) => { if (!t) return null; const rm = legacyRemovals(t, cfg); keys = Object.keys(rm); return keys.length ? setTopLevel(t, rm).replace(/\n*$/, "\n") : null; });
    if (r.error) { writeFailures.push(r.error); return []; }
    if (r.changed) writeProfiles(cfg); return r.changed ? keys : [];
  } catch { return []; }
}
export function applyMode(mode, cfg = loadConfig(), surplus = false) {
  const f = path.join(codexHome(), "config.toml");
  // An unreadable config.toml is never treated as empty: the file is left exactly as it is and the failure is reported.
  const r = editText(f, (t) => setTopLevel(t, { ...legacyRemovals(t, cfg), ...modeKV(cfg.modes[mode === "green" && surplus ? "surplus" : mode], cfg) }).replace(/\n*$/, "\n"));
  if (r.error) { writeFailures.push(r.error); console.error("usage-max: " + r.error); return r; }
  writeProfiles(cfg); markApplied(modeKey(mode, surplus)); return r;
}
export function modelsSeen() {
  const out = {}; for (const f of walk(path.join(codexHome(), "sessions"))) { let t; try { t = fs.readFileSync(f, "utf8"); } catch { continue; } for (const m of t.matchAll(/"model"\s*:\s*"([^"]+)"/g)) out[m[1]] = (out[m[1]] || 0) + 1; }
  return out;
}
// `doctor`: say plainly whether usage-max is actually active in Codex, and what to do if not.
export function doctor(home = codexHome(), platform = process.platform) {
  const out = []; const ok = (m) => out.push(`  ok   ${m}`); const bad = (m, fix) => out.push(`  FIX  ${m}${fix ? `\n       -> ${fix}` : ""}`);
  const rd = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
  const cfg = loadConfig(); const toml = rd(path.join(home, "config.toml")); const hooks = rd(path.join(home, "hooks.json")); const gs = j(path.join(dataDir(), "governor.json"), {}); const seen = j(path.join(dataDir(), "hook-seen.json"), {});
  { const src = {}; for (const m of toml.matchAll(/^\s*\[(?:hooks\.state|plugins)\.[^\]\n]*?usage-max@([\w.-]+)[^\]\n]*\]/gm)) src[m[1]] = (src[m[1]] || 0) + 1;
    const total = Object.values(src).reduce((a, b) => a + b, 0), list = Object.entries(src).map(([k, v]) => `usage-max@${k} x${v}`).join(", "), old = Object.keys(src).filter((k) => /synced|upload|local/i.test(k));
    old.length ? bad(`Codex still has hook/plugin entries for the UPLOADED copy of usage-max (${list}). That old copy (0.1.x) runs Claude-only hooks inside Codex and can disrupt turns`, "remove the old usage-max plugin in Codex's plugin list, then install the current one (it ships Codex-specific hooks)") : ok(total ? `Codex's usage-max entries come from the marketplace install only (${list})` : "no usage-max plugin entries in Codex config"); }

  /codex-hook\.mjs/.test(hooks) ? ok("hooks.json has the usage-max hooks") : bad("hooks not installed", "node scripts/install.mjs");
  { const bin = binDir().replace(/\\/g, "/"); const paths = [...hooks.matchAll(/"?([^"\s]*)codex-hook\.mjs/g)].map((m) => m[1].replace(/\\\\/g, "/").replace(/\\/g, "/"));
    const ver = rd(path.join(binDir(), "VERSION")).trim();
    paths.length && paths.some((p) => !p.startsWith(bin + "/")) ? bad("scripts run from a stable location (" + bin + "), not from a plugin cache path: hooks.json points elsewhere", "node <plugin>/codex/scripts/install.mjs again") : ok("scripts run from a stable location (" + bin + "), not from a plugin cache path" + (ver ? ` (installed version ${ver})` : ""));
    let pv = ""; try { pv = String(JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude-plugin", "plugin.json"), "utf8")).version || ""); } catch {}
    if (pv && ver && pv !== ver) bad(`the Codex scripts in use are version ${ver} but the plugin is ${pv}: new Codex features (diagnose, guards, weights) are not active yet`, "they refresh at your next Claude Code session start, or now with: usage-max doctor --fix (or node <plugin>/codex/scripts/install.mjs)"); }
  const evs = Object.keys(seen);
  if (evs.length) ok(`hooks are running (last: ${evs.map((e) => `${e} ${seen[e].slice(11, 19)}`).join(", ")})`);
  else if (/codex-hook\.mjs/.test(hooks)) bad("hooks are installed but have NEVER run — Codex skips hooks until you trust them", "start Codex, type /hooks, select the usage-max hooks and trust them (the path never changes, so you only do this once)");
  /^\s*notify\s*=/m.test(toml) ? ok("notify is set (fallback metering)") : bad("notify not set (optional fallback)", "node scripts/install.mjs");
  const placeholder = Object.values(cfg.modes).some((m) => m.model && /^gpt-6/.test(m.model) && !modelsSeen()[m.model]);
  placeholder ? bad("a mode uses a model name your sessions never used (placeholder?)", "node scripts/codex-governor.mjs models, then edit ~/.usage-max-codex/config.json modes") : ok("mode models are unset (your own model is kept) or match models you have used");
  gs.calib ? ok(`calibrated (${gs.calib.source === "plan" ? "automatically from Codex rate_limits" : "manually"}): ${gs.calib.pct}%`) : bad("not calibrated yet", "use Codex once (the plan % is read from its own logs) or: calibrate <pct from /status> --resets <ISO>");
  /usage-max:start/.test(rd(path.join(home, "AGENTS.md"))) ? ok("AGENTS.md block present") : bad("AGENTS.md block missing", "node scripts/install.mjs");
  { const o = readOther(); o ? (isFresh(o) ? ok("shared status with Claude: fresh") : ok("shared status with Claude: stale")) : ok("shared status with Claude: none"); }
  { const tok = j(path.join(dataDir(), "trim-ok.json"), null), ts = j(path.join(dataDir(), "trim-stats.json"), null), off = process.env.USAGE_MAX_TRIM === "off" || cfg.trim === "off";
    if (off) ok("output trimming is switched OFF (USAGE_MAX_TRIM=off or config.json trim:\"off\")");
    else if (tok && tok.ok) ok(`output trimming self-test passed (${(tok.shells || []).join(", ")}) on ${String(tok.at).slice(0, 10)}`);
    else if (platform === "win32") bad("output trimming is disabled on Windows until the self-test passes", `run: node ${binDir().replace(/\\/g, "/")}/scripts/codex-governor.mjs selftest-trim`);
    else ok("output trimming self-test not needed (enabled by default on this platform)");
    if (ts) ok(`trim stats: ${ts.rewrites} rewrites, ${ts.rawBytes} -> ${ts.outBytes} bytes (last ${ts.lastAt})`); }
  const walkCount = [...walk(path.join(home, "sessions"))].length; walkCount ? ok(`${walkCount} Codex session logs found`) : bad("no Codex session logs under " + path.join(home, "sessions"), "run Codex once; check CODEX_HOME");
  return out.join("\n");
}
export async function selftestTrim(platform = process.platform) {
  const { wrap } = await import("./run-trimmed.mjs"); const here = path.dirname(fileURLToPath(import.meta.url)); const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "umtrim-")); const env = { ...process.env, USAGE_MAX_HOME: tmpHome };
  fs.writeFileSync(path.join(tmpHome, "noisy.mjs"), "for(let i=0;i<400;i++)console.log('line '+i);console.error('ERROR boom');process.exitCode=3;\n");
  const wrapped = wrap("node noisy.mjs", path.join(here, "run-trimmed.mjs")); // plain words only, run with cwd = tmpHome
  const shells = platform === "win32" ? [["powershell", "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", wrapped], {}], ["cmd", "cmd.exe", ["/d", "/s", "/c", `"${wrapped}"`], { windowsVerbatimArguments: true }]] : [["sh", "sh", ["-c", wrapped], {}]];
  const res = [];
  const rawShells = platform === "win32" ? [["powershell", "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "node noisy.mjs"], {}], ["cmd", "cmd.exe", ["/d", "/s", "/c", '"node noisy.mjs"'], { windowsVerbatimArguments: true }]] : [["sh", "sh", ["-c", "node noisy.mjs"], {}]];
  for (const [i, [name, exe, args, opt]] of shells.entries()) {
    const r = spawnSync(exe, args, { env, cwd: tmpHome, encoding: "utf8", timeout: 60000, ...opt }); if (r.error && r.error.code === "ENOENT") { res.push({ name, skipped: true }); continue; }
    // PowerShell -Command reports 1 for ANY failing command, trimmed or not, so the exit code is compared with the same command run WITHOUT the wrapper in the same shell.
    const [, rexe, rargs, ropt] = rawShells[i]; const base = spawnSync(rexe, rargs, { env, cwd: tmpHome, encoding: "utf8", timeout: 60000, ...ropt });
    const out = (r.stdout || "") + (r.stderr || ""); const checks = { sameExitAsUntrimmed: base.status !== 0 && r.status === base.status, trimmed: /trimmed/.test(out), error: /ERROR boom/.test(out), tail: /line 399/.test(out) };
    res.push({ name, pass: Object.values(checks).every(Boolean), checks, status: r.status, want: base.status, bytes: out.length });
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  const ran = res.filter((x) => !x.skipped), pass = ran.length > 0 && ran.every((x) => x.pass), f = path.join(dataDir(), "trim-ok.json");
  if (pass) wj(f, { ok: true, at: new Date().toISOString(), shells: ran.map((x) => x.name) }); else try { fs.rmSync(f, { force: true }); } catch {}
  return { pass, res };
}
async function extCli(cmd, a, flag) {
  if (cmd === "selftest-trim") { const { pass, res } = await selftestTrim(); for (const x of res) console.log(x.skipped ? `SKIP ${x.name}: not found` : `${x.pass ? "PASS" : "FAIL"} ${x.name}: exit=${x.status} (same command untrimmed gives ${x.want}) ${Object.entries(x.checks).map(([k, v]) => `${k}=${v ? "ok" : "NO"}`).join(" ")} output=${x.bytes}B`);
    console.log(pass ? `trim self-test PASSED: trim-ok.json written (${path.join(dataDir(), "trim-ok.json")})` : "trim self-test FAILED or no shell ran: trim-ok.json removed, rewriting stays off on Windows"); return (pass ? 0 : 1); }
  if (cmd === "savings") { const { savings, format } = await import("./savings.mjs"); const d = flag("--days"); const r = savings({ days: d ? Number(d) || 7 : 7, since: flag("--since") }); console.log(a.includes("--json") ? JSON.stringify(r, null, 2) : format(r)); return (0); }
  if (cmd === "backup") { const { backup } = await import("./backup.mjs"); try { const r = backup(flag("--out")); console.log(`backup written: ${r.dir}\n  ${r.files.length} files; skipped (missing): ${r.skipped.join(", ") || "none"}`); return (0); } catch (e) { console.error("backup failed: " + e.message); return (1); } }
  if (cmd === "restore") { const B = await import("./backup.mjs"); const chk = a.indexOf("--check") >= 0, dir = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--out")[0];
    if (!dir || (!chk && !a.includes("--apply"))) { console.error("usage: restore --check <dir>   |   restore <dir> --apply [--out <dir for the pre-restore backup>]"); return (2); }
    if (chk) { const c = B.check(path.resolve(dir)); if (c.error) console.log("FAIL " + c.error); for (const r of c.rows) console.log(`${r.verified ? "ok  " : "BAD "} ${r.path}  [${r.verified ? "sha256 verified" : "sha256 MISMATCH/missing"}; ${r.state}]`); console.log(c.ok ? "manifest check OK (nothing changed)" : "manifest check FAILED"); return (c.ok ? 0 : 1); }
    try { const r = B.restore(path.resolve(dir), flag("--out")); if (r.error) { console.error("restore refused: " + r.error); return (1); } console.log(`restored ${r.restored.length} files; pre-restore backup: ${r.preRestore}\nNext: fully quit and reopen the Codex app, then run /hooks in the Codex CLI and confirm the usage-max hooks show as trusted.`); return (0); } catch (e) { console.error("restore failed: " + e.message); return (1); } }
}
const EXT = new Set(["selftest-trim", "savings", "backup", "restore"]);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd = "status", ...a] = process.argv.slice(2); const flag = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  if (cmd === "doctor") { console.log("usage-max codex doctor:\n" + doctor()); process.exit(0); }
  if (EXT.has(cmd)) extCli(cmd, a, flag).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); }); else {
  if (cmd === "models") { const m = modelsSeen(); console.log(Object.keys(m).length ? "models seen in your Codex sessions (set config.json modes to ones your plan has):\n" + Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}  (${v})`).join("\n") : "no sessions found under " + codexHome()); process.exit(0); }
  if (cmd === "calibrate") { const pct = Number(a[0]); const r = flag("--resets"); if (!(pct >= 0) || !r) { console.error("usage: calibrate <pct from /status or chatgpt.com/codex/settings/usage> --resets <ISO>"); process.exit(2); } calibrate(pct, r); }
  if (cmd === "mode") { const sf = path.join(dataDir(), "governor.json"); const st = j(sf, {}); st.override = a[0] === "auto" ? null : a[0]; wj(sf, st); }
  const { mode, surplus, e, st, cfg } = evaluate(Date.now(), true);
  if ((cmd === "mode" || cmd === "calibrate") && writeFailures.length) { console.error(`could not save (${[...new Set(writeFailures)].join(", ")}): this shell is read-only (Codex sandbox?). Run the same command from a normal terminal.`); process.exit(1); }
  if (writeFailures.length) console.log(`note: could not save state (${[...new Set(writeFailures)].join(", ")}) because this shell is read-only (the Codex sandbox). Numbers below are computed live from Codex's own logs; the hooks (which run outside the sandbox) keep the saved state current.`);
  if (cmd === "apply" || cmd === "mode" || cmd === "calibrate") { try { applyMode(mode, cfg, surplus); } catch (x) { console.error("apply failed:", x.message); } }
  if (cmd === "profiles") writeProfiles(cfg);
  const mc = cfg.modes[mode === "green" && surplus ? "surplus" : mode];
  console.log(`mode=${mode.toUpperCase()}${surplus ? "+SURPLUS" : ""}${st.override ? " (manual)" : ""}  new sessions: ${mc.model || "(your model)"} @ ${mc.effort}`);
  if (st.calib && st.calib.source === "plan") console.log(`plan (from Codex rate_limits): weekly ${st.calib.pct}% as of ${new Date(st.calib.at).toLocaleString()}${st.five ? `, 5h window ${st.five.pct}%` : ""}`);
  console.log(e ? `est plan ${e.est.toFixed(1)}%  hours to reset ${e.hoursLeft.toFixed(1)}  burn ${e.rate.toFixed(2)}%/h  sustainable ${(Math.max(0, cfg.target - e.est) / Math.max(e.hoursLeft, .5)).toFixed(2)}%/h` : "not calibrated: run `calibrate <pct> --resets <ISO>` using the % shown by /status");
  if (surplus && e) { const p = e.projected; console.log(`surplus: projected ~${Math.round(p)}% at reset, ~${Math.round(100 - p)}% of the week would go unused — higher effort allowed on hard problems`); }
  { const o = readOther(); if (o && isFresh(o)) console.log(`claude plan: ${o.mode}${o.surplus ? "+surplus" : ""}${typeof o.estPct === "number" ? `, week ~${Math.round(o.estPct)}% used` : ""}${typeof o.hoursLeft === "number" ? `, ${Math.round(o.hoursLeft)}h to reset` : ""}`); }
  if (cmd === "gate") process.exit({ green: 0, amber: 10, red: 20 }[mode]);
  }
}
