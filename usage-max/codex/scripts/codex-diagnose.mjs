// Where did my Codex plan go? Read-only, local rollouts only. Codex logs the plan's real rate limits on every token_count event, so
// the weekly % that moved between two events is attributed to the session/model/effort/folder that made the later call (measured,
// not estimated). Token mix and context size per call come from the same events.
import fs from "node:fs"; import path from "node:path";
import { codexHome, walk } from "./codex-governor.mjs";
const pct = (rl) => (rl && typeof rl.used_percent === "number" ? rl.used_percent : null);
export function collect(home = codexHome(), days = 7, now = Date.now()) {
  const lo = now - days * 864e5, ev = [];
  for (const f of walk(path.join(home, "sessions"))) {
    let st, text; try { st = fs.statSync(f); if (st.mtimeMs < lo) continue; text = fs.readFileSync(f, "utf8"); } catch { continue; }
    let model = "?", effort = "?", cwd = "?", source = "?";
    for (const line of text.split("\n")) {
      if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } const p = o.payload && typeof o.payload === "object" ? o.payload : o;
      if (o.type === "session_meta") { cwd = p.cwd || cwd; source = (typeof p.source === "string" ? p.source : p.originator) || source; model = p.model || model; }
      if (o.type === "turn_context" || p.type === "turn_context") { model = p.model || model; effort = p.effort || p.reasoning_effort || p.collaboration_mode?.settings?.reasoning_effort || effort; cwd = p.cwd || cwd; }
      if (p.type !== "token_count") continue; const t = Date.parse(o.timestamp || p.timestamp) || st.mtimeMs; if (t < lo || t > now) continue;
      const u = (p.info || p).last_token_usage, rl = p.rate_limits || o.rate_limits || {};
      ev.push({ t, f, model, effort, cwd, source, input: u?.input_tokens || 0, cached: u?.cached_input_tokens || 0, output: u?.output_tokens || 0, reasoning: u?.reasoning_output_tokens || 0, wk: pct(rl.secondary), h5: pct(rl.primary) });
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}
export function analyze(ev) {
  const R = { events: ev.length, files: new Set(), wkTotal: 0, h5Total: 0, by: { session: {}, lane: {}, day: {}, folder: {}, source: {} }, tok: { fresh: 0, cached: 0, output: 0, reasoning: 0 }, ctx: [] };
  let pw = null, p5 = null;
  for (const e of ev) {
    R.files.add(e.f); R.tok.fresh += Math.max(e.input - e.cached, 0); R.tok.cached += e.cached; R.tok.output += e.output; R.tok.reasoning += e.reasoning; if (e.input) R.ctx.push(e.input);
    let dw = 0, d5 = 0; if (e.wk != null) { if (pw != null && e.wk >= pw) dw = e.wk - pw; pw = e.wk; } if (e.h5 != null) { if (p5 != null && e.h5 >= p5) d5 = e.h5 - p5; p5 = e.h5; }
    R.wkTotal += dw; R.h5Total += d5;
    const add = (g, k) => { const b = (R.by[g][k] = R.by[g][k] || { wk: 0, h5: 0, calls: 0, input: 0 }); b.wk += dw; b.h5 += d5; b.calls++; b.input += e.input; };
    add("session", path.basename(e.f).replace(/^rollout-/, "").slice(0, 30)); add("lane", `${e.model}/${e.effort}`); add("day", new Date(e.t).toISOString().slice(0, 10)); add("folder", e.cwd); add("source", e.source);
  }
  R.ctx.sort((a, b) => a - b); const q = (x) => R.ctx.length ? R.ctx[Math.min(R.ctx.length - 1, Math.floor(R.ctx.length * x))] : 0;
  R.ctxStats = { median: q(0.5), p90: q(0.9), over100k: R.ctx.filter((x) => x > 1e5).length / (R.ctx.length || 1) };
  return R;
}
export function findings(R) {
  const F = [], top = (g) => Object.entries(R.by[g]).sort((a, b) => b[1].wk - a[1].wk);
  if (!R.events) return F; const hasPct = R.wkTotal > 0;
  if (hasPct) {
    const s = top("session")[0]; if (s && s[1].wk / R.wkTotal > 0.3) F.push(`one session (${s[0]}) used ${Math.round(100 * s[1].wk / R.wkTotal)}% of the weekly % that moved. Long sessions re-read their whole context every call: finish and start fresh (or hand off) instead of continuing.`);
    const hi = top("lane").filter(([k]) => /\/(high|xhigh)$/.test(k)).reduce((a, [, v]) => a + v.wk, 0); if (hi / R.wkTotal > 0.5) F.push(`${Math.round(100 * hi / R.wkTotal)}% of the weekly % went to high/xhigh effort. Routine edits and reads rarely need it.`);
    const f = top("folder")[0]; if (f && Object.keys(R.by.folder).length > 1 && f[1].wk / R.wkTotal > 0.5) F.push(`${Math.round(100 * f[1].wk / R.wkTotal)}% went to one folder (${f[0]}): check its AGENTS.md size, MCP servers and skills.`);
    const d = top("day")[0]; if (d && Object.keys(R.by.day).length > 2 && d[1].wk / R.wkTotal > 0.4) F.push(`${Math.round(100 * d[1].wk / R.wkTotal)}% went on a single day (${d[0]}).`);
  } else F.push("no rate-limit percentages in these logs (older Codex version, or no usage in the window), so attribution below uses tokens only.");
  if (R.ctxStats.median > 60000) F.push(`median context per call is ${R.ctxStats.median.toLocaleString("en-US")} tokens (${Math.round(100 * R.ctxStats.over100k)}% of calls above 100k). Big context multiplies every call: keep AGENTS.md small, fewer MCP servers/skills, /new between tasks, compact earlier.`);
  const t = R.tok, tot = t.fresh + t.cached + t.output; if (tot && t.output / tot > 0.15) F.push(`output (including reasoning) is ${Math.round(100 * t.output / tot)}% of tokens, which is unusually high and is the expensive kind: lower reasoning effort.`);
  const src = top("source").filter(([k]) => /exec|cloud|automation|api/i.test(k)); const srcWk = src.reduce((a, [, v]) => a + v.wk, 0); if (hasPct && srcWk / R.wkTotal > 0.25) F.push(`${Math.round(100 * srcWk / R.wkTotal)}% came from non-interactive runs (${src.map(([k]) => k).join(", ")}): codex exec, automations or tools that call Codex for you (e.g. the codex-review / codex-dispatch plugins).`);
  return F;
}
export function format(R, days) {
  const n = (x) => Math.round(x).toLocaleString("en-US"), o = [], M = (s) => o.push("measured  " + s), top = (g, k = 5) => Object.entries(R.by[g]).sort((a, b) => b[1].wk - a[1].wk || b[1].calls - a[1].calls).slice(0, k);
  o.push(`CODEX diagnose: last ${days} days, local logs only, read-only`);
  if (!R.events) { o.push("  no Codex token events found (run this on the PC where Codex runs; CODEX_HOME if it is not ~/.codex)."); return o.join("\n"); }
  M(`${R.files.size} sessions, ${R.events} calls; weekly % that moved: ${R.wkTotal.toFixed(1)} points, 5-hour % that moved: ${R.h5Total.toFixed(1)} points`);
  M(`tokens: fresh input ${n(R.tok.fresh)}, cached input ${n(R.tok.cached)}, output ${n(R.tok.output)} (of which reasoning ${n(R.tok.reasoning)}); context per call: median ${n(R.ctxStats.median)}, p90 ${n(R.ctxStats.p90)}`);
  const sect = (title, g, label) => { o.push(`  ${title}:`); for (const [k, v] of top(g)) o.push(`    ${v.wk.toFixed(1).padStart(5)} wk-pts ${String(v.calls).padStart(5)} calls  ${(label ? label(k) : k).slice(0, 70)}`); };
  sect("by session", "session"); sect("by model/effort", "lane"); sect("by day", "day"); sect("by folder", "folder"); sect("by how it was started", "source");
  const F = findings(R); o.push(F.length ? "what stands out:" : "nothing stands out."); for (const f of F) o.push("  - " + f);
  return o.join("\n");
}
export function diagnose({ days = 7, home = codexHome(), now = Date.now() } = {}) { const R = analyze(collect(home, days, now)); return { R, text: format(R, days), findings: findings(R) }; }
if (process.argv[1]?.endsWith("codex-diagnose.mjs")) { const a = process.argv.slice(2), i = a.indexOf("--days"); console.log(diagnose({ days: i < 0 ? 7 : Number(a[i + 1]) || 7 }).text); }
