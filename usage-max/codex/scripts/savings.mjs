// Read-only savings report from local Codex rollouts. Never writes. Every figure is labelled measured or estimate; missing telemetry is "not available".
import fs from "node:fs"; import path from "node:path";
import { codexHome, dataDir, walk } from "./codex-governor.mjs";
const j = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const blank = () => ({ files: new Set(), turns: 0, toolBytes: 0, toolOutputs: 0, tokEvents: 0, input: 0, cached: 0, output: 0, lanes: {} });
const outBytes = (p) => { const o = p.output; if (typeof o === "string") return Buffer.byteLength(o); if (o && typeof o === "object") { const c = o.content; if (typeof c === "string") return Buffer.byteLength(c); if (Array.isArray(c)) return c.reduce((a, x) => a + Buffer.byteLength(typeof x === "string" ? x : String((x && (x.text ?? x.content)) ?? "")), 0); } return 0; };
export function modeTime(history, from, to) {
  if (!Array.isArray(history) || !history.length) return null;
  const h = history.map((x) => ({ at: Date.parse(x.at), from: x.from, to: x.to })).filter((x) => x.at).sort((a, b) => a.at - b.at); if (!h.length) return null;
  const out = {}; const add = (m, a, b) => { const s = Math.max(a, from), e = Math.min(b, to); if (m && e > s) out[m] = (out[m] || 0) + (e - s); };
  add(h[0].from, -Infinity, h[0].at); for (let i = 0; i < h.length; i++) add(h[i].to, h[i].at, i + 1 < h.length ? h[i + 1].at : to);
  return out;
}
export function savings({ days = 7, since = null, now = Date.now() } = {}) {
  const gs = j(path.join(dataDir(), "governor.json"), {}); const ia = gs.installedAt ? Date.parse(gs.installedAt) : NaN; const sinceMs = since ? Date.parse(since) : NaN;
  const split = Number.isFinite(ia) ? ia : Number.isFinite(sinceMs) ? sinceMs : null; const splitFrom = split === null ? null : Number.isFinite(ia) ? "installedAt" : "--since";
  const span = days * 864e5; const lo = splitFrom === "--since" ? split - span : Number.isFinite(sinceMs) ? sinceMs : now - span;
  const R = { all: blank() }; if (split !== null) { R.before = blank(); R.after = blank(); }
  const sel = (ts) => { if (ts < lo || ts > now) return []; const r = [R.all]; if (split !== null) r.push(ts < split ? R.before : R.after); return r; };
  for (const f of walk(path.join(codexHome(), "sessions"))) {
    let st, text; try { st = fs.statSync(f); if (st.mtimeMs < lo) continue; text = fs.readFileSync(f, "utf8"); } catch { continue; }
    let model = null, effort = "?";
    for (const line of text.split("\n")) {
      if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } if (!o || typeof o !== "object") continue;
      const p = o.payload && typeof o.payload === "object" ? o.payload : o; const ts = Date.parse(o.timestamp || p.timestamp) || st.mtimeMs; const rs = sel(ts);
      for (const r of rs) r.files.add(f);
      const ty = p.type || o.type;
      if (o.type === "turn_context" || p.type === "turn_context") {
        model = p.model || model; effort = p.effort || p.reasoning_effort || p.collaboration_mode?.settings?.reasoning_effort || "?";
        for (const r of rs) { r.turns++; const k = `${model || "?"}/${effort}`; r.lanes[k] = (r.lanes[k] || 0) + 1; }
      } else if (o.type === "session_meta") { model = p.model || model; }
      if ((o.type === "response_item" || p.type) && (ty === "function_call_output" || ty === "custom_tool_call_output")) { const b = outBytes(p); for (const r of rs) { r.toolBytes += b; r.toolOutputs++; } }
      if (ty === "token_count") { const u = (p.info || p).last_token_usage; if (u && typeof u === "object") for (const r of rs) { r.tokEvents++; r.input += u.input_tokens || 0; r.cached += u.cached_input_tokens || 0; r.output += u.output_tokens || 0; } }
    }
  }
  const fin = (r) => ({ sessions: r.files.size, turns: r.turns, toolOutputBytes: r.toolBytes, toolOutputs: r.toolOutputs, tokens: r.tokEvents ? { input: r.input, cachedInput: r.cached, output: r.output, events: r.tokEvents } : null, lanes: r.lanes,
    perTurn: r.turns ? { toolOutputBytes: Math.round(r.toolBytes / r.turns), inputTokens: r.tokEvents ? Math.round(r.input / r.turns) : null } : null });
  const ts = j(path.join(dataDir(), "trim-stats.json"), null);
  const rep = { window: { from: new Date(lo).toISOString(), to: new Date(now).toISOString(), days: Math.round((now - lo) / 864e5 * 10) / 10 }, split: split === null ? null : { at: new Date(split).toISOString(), source: splitFrom },
    measured: { ...fin(R.all), trim: ts ? { rewrites: ts.rewrites || 0, rawBytes: ts.rawBytes || 0, outBytes: ts.outBytes || 0, lastAt: ts.lastAt || null, scope: "cumulative since first rewrite" } : null, modeTimeMs: modeTime(gs.history, lo, now) },
    estimate: { toolOutputTokens: Math.round(R.all.toolBytes / 4), trimTokensRemoved: ts ? Math.round(Math.max(0, (ts.rawBytes || 0) - (ts.outBytes || 0)) / 4) : null, basis: "bytes/4" } };
  if (split !== null) rep.beforeAfter = { before: fin(R.before), after: fin(R.after), note: "workload-dependent, not a guarantee" };
  return rep;
}
export function format(r) {
  const o = []; const M = (s) => o.push(`measured  ${s}`), E = (s) => o.push(`estimate  ${s}`), n = (x) => Number(x).toLocaleString("en-US"); const m = r.measured;
  o.push(`usage-max savings: ${r.window.from.slice(0, 10)} .. ${r.window.to.slice(0, 10)} (${r.window.days} days, local Codex logs only; read-only)`);
  M(`sessions ${m.sessions}, turns ${m.turns}`); M(`tool output ${n(m.toolOutputBytes)} bytes in ${m.toolOutputs} outputs`);
  m.tokens ? M(`provider-reported tokens (token_count last_token_usage): input ${n(m.tokens.input)}, cached input ${n(m.tokens.cachedInput)}, output ${n(m.tokens.output)}`) : M("provider-reported tokens: not available in logs");
  m.trim ? M(`trim rewrites ${n(m.trim.rewrites)}, raw ${n(m.trim.rawBytes)} bytes -> out ${n(m.trim.outBytes)} bytes (${m.trim.scope}${m.trim.lastAt ? `, last ${m.trim.lastAt}` : ""})`) : M("trim rewrites: none recorded (trim-stats.json absent)");
  const lanes = Object.entries(m.lanes).sort((a, b) => b[1] - a[1]); M(lanes.length ? "model/effort lanes (turns): " + lanes.map(([k, v]) => `${k} ${v}`).join(", ") : "model/effort lanes: none found");
  if (m.modeTimeMs) { const tot = Object.values(m.modeTimeMs).reduce((a, b) => a + b, 0) || 1; M("budget mode time: " + Object.entries(m.modeTimeMs).map(([k, v]) => `${k} ${(v / 36e5).toFixed(1)}h (${Math.round(100 * v / tot)}%)`).join(", ")); } else M("budget mode time: no history recorded yet");
  E(`tool-output tokens ~${n(r.estimate.toolOutputTokens)} (${r.estimate.basis})`);
  r.estimate.trimTokensRemoved === null ? E("tokens removed by trim: not available (no trim-stats.json)") : E(`tokens removed by trim ~${n(r.estimate.trimTokensRemoved)} (${r.estimate.basis}, (raw-out)/4)`);
  if (r.beforeAfter) { const b = r.beforeAfter.before, a = r.beforeAfter.after; o.push(`before/after split at ${r.split.at} (${r.split.source}); ${r.beforeAfter.note}`);
    const row = (lbl, x, y, dp) => { if (x == null || y == null) return M(`${lbl}: not available`); const d = y - x; M(`${lbl}: before ${n(x)} -> after ${n(y)} (${d >= 0 ? "+" : ""}${n(d)}${x ? `, ${d >= 0 ? "+" : ""}${Math.round(100 * d / x)}%` : ""})`); };
    M(`before: ${b.sessions} sessions, ${b.turns} turns; after: ${a.sessions} sessions, ${a.turns} turns`);
    row("tool-output bytes/turn", b.perTurn?.toolOutputBytes, a.perTurn?.toolOutputBytes); row("input tokens/turn", b.perTurn?.inputTokens, a.perTurn?.inputTokens);
  } else o.push("before/after: no split point. Run the installer (records installedAt) or pass --since <ISO> to split the window.");
  return o.join("\n");
}
