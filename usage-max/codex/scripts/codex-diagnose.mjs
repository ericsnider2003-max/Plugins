// Where did my Codex plan go? Read-only, local rollouts only. Codex logs the plan's real rate limits on every token_count event, so
// the weekly % that moved between two events is attributed to the session/model/effort/folder that made the later call (measured,
// not estimated). Token mix and context size per call come from the same events.
import fs from "node:fs"; import path from "node:path";
import { codexHome, walk } from "./codex-governor.mjs";
const pct = (rl) => (rl && typeof rl.used_percent === "number" ? rl.used_percent : null);
// Same rule as the governor: the weekly window is the one that lasts a week (>= 7000 min), the short one <= 600 min. Which of primary/secondary it is varies by plan and version.
export function splitLimits(rl) {
  const ws = [rl && rl.primary, rl && rl.secondary].filter((w) => w && typeof w.used_percent === "number");
  if (ws.some((w) => w.window_minutes)) return { wk: pct(ws.filter((w) => w.window_minutes >= 7000)[0]), h5: pct(ws.filter((w) => w.window_minutes && w.window_minutes <= 600)[0]) };
  return { wk: pct(rl && rl.secondary), h5: pct(rl && rl.primary) }; // old logs without window lengths
}
export function collect(home = codexHome(), days = 7, now = Date.now()) {
  const lo = now - days * 864e5, ev = [];
  for (const f of walk(path.join(home, "sessions"))) {
    let st, text; try { st = fs.statSync(f); if (st.mtimeMs < lo) continue; text = fs.readFileSync(f, "utf8"); } catch { continue; }
    let model = "?", effort = "?", cwd = "?", source = "?", seenFirst = false;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } const p = o.payload && typeof o.payload === "object" ? o.payload : o;
      if (o.type === "session_meta") { cwd = p.cwd || cwd; source = (typeof p.source === "string" ? p.source : p.originator) || source; model = p.model || model; }
      if (o.type === "turn_context" || p.type === "turn_context") { model = p.model || model; effort = p.effort || p.reasoning_effort || p.collaboration_mode?.settings?.reasoning_effort || effort; cwd = p.cwd || cwd; }
      if (p.type !== "token_count") continue; const t = Date.parse(o.timestamp || p.timestamp) || st.mtimeMs; if (t < lo || t > now) continue;
      const u = (p.info || p).last_token_usage, rl = p.rate_limits || o.rate_limits || {}, lim = splitLimits(rl); const first = !seenFirst; seenFirst = true;
      ev.push({ t, f, model, effort, cwd, source, input: u?.input_tokens || 0, cached: u?.cached_input_tokens || 0, output: u?.output_tokens || 0, reasoning: u?.reasoning_output_tokens || 0, wk: lim.wk, h5: lim.h5, first });
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
  R.start = ev.filter((e) => e.first && e.input).map((e) => e.input).sort((a, b) => a - b); R.startMedian = R.start.length ? R.start[Math.floor(R.start.length / 2)] : 0;
  R.ctx.sort((a, b) => a - b); const q = (x) => R.ctx.length ? R.ctx[Math.min(R.ctx.length - 1, Math.floor(R.ctx.length * x))] : 0;
  R.ctxStats = { median: q(0.5), p90: q(0.9), over100k: R.ctx.filter((x) => x > 1e5).length / (R.ctx.length || 1) };
  return R;
}
// What a new session in a folder loads before you type anything: AGENTS.md files up the folder tree, and the skills Codex can see.
export function startupWeight(cwd, home = codexHome(), userHome = path.dirname(home)) {
  const files = []; let d = path.resolve(cwd || "."); for (let i = 0; i < 6; i++) { for (const n of ["AGENTS.md", "AGENTS.override.md"]) { const f = path.join(d, n); try { const st = fs.statSync(f); if (st.isFile()) files.push({ f, tokens: Math.round(st.size / 4) }); } catch {} } const up = path.dirname(d); if (up === d) break; d = up; }
  try { const f = path.join(home, "AGENTS.md"), st = fs.statSync(f); if (st.isFile() && !files.some((x) => x.f === f)) files.push({ f, tokens: Math.round(st.size / 4) }); } catch {}
  const countSkills = (root, depth = 0) => { let n = 0; if (depth > 3) return 0; let es; try { es = fs.readdirSync(root, { withFileTypes: true }); } catch { return 0; } for (const e of es) { if (e.isDirectory()) n += countSkills(path.join(root, e.name), depth + 1); else if (e.name === "SKILL.md") n++; } return n; };
  const skillRoots = [path.join(home, "skills"), path.join(userHome, ".agents", "skills"), path.join(cwd || ".", ".codex", "skills"), path.join(cwd || ".", ".agents", "skills")];
  const skills = skillRoots.map((r) => ({ r, n: countSkills(r) })).filter((x) => x.n);
  return { files, skills, agentsTokens: files.reduce((a, x) => a + x.tokens, 0), skillCount: skills.reduce((a, x) => a + x.n, 0) };
}
export function compactLimit(home = codexHome()) { try { const m = fs.readFileSync(path.join(home, "config.toml"), "utf8").match(/^\s*model_auto_compact_token_limit\s*=\s*(\d+)/m); return m ? Number(m[1]) : null; } catch { return undefined; } }
export function findings(R, limit) {
  const F = [], top = (g) => Object.entries(R.by[g]).sort((a, b) => b[1].wk - a[1].wk);
  if (!R.events) return F; const hasPct = R.wkTotal > 0;
  if (hasPct) {
    const s = top("session")[0]; if (s && s[1].wk / R.wkTotal > 0.3) F.push(`one session (${s[0]}) used ${Math.round(100 * s[1].wk / R.wkTotal)}% of the weekly % that moved. Long sessions re-read their whole context every call: finish and start fresh (or hand off) instead of continuing.`);
    const hi = top("lane").filter(([k]) => /\/(high|xhigh)$/.test(k)).reduce((a, [, v]) => a + v.wk, 0); if (hi / R.wkTotal > 0.5) F.push(`${Math.round(100 * hi / R.wkTotal)}% of the weekly % went to high/xhigh effort. Routine edits and reads rarely need it.`);
    const f = top("folder")[0]; if (f && Object.keys(R.by.folder).length > 1 && f[1].wk / R.wkTotal > 0.5) F.push(`${Math.round(100 * f[1].wk / R.wkTotal)}% went to one folder (${f[0]}): check its AGENTS.md size, MCP servers and skills.`);
    const d = top("day")[0]; if (d && Object.keys(R.by.day).length > 2 && d[1].wk / R.wkTotal > 0.4) F.push(`${Math.round(100 * d[1].wk / R.wkTotal)}% went on a single day (${d[0]}).`);
  } else F.push("no rate-limit percentages in these logs (older Codex version, or no usage in the window), so attribution below uses tokens only.");
  const sesTop = Object.entries(R.by.session).sort((a, b) => b[1].calls - a[1].calls)[0]; if (sesTop && R.events > 200 && sesTop[1].calls / R.events > 0.25) F.push(`one session made ${sesTop[1].calls.toLocaleString("en-US")} of your ${R.events.toLocaleString("en-US")} calls (${Math.round(100 * sesTop[1].calls / R.events)}%). A session that runs that long re-reads its whole history on every call: finish a task, then start a new session (or hand off) instead of continuing.`);
  const fold = Object.entries(R.by.folder).sort((a, b) => b[1].calls - a[1].calls)[0]; if (fold && Object.keys(R.by.folder).length > 1 && fold[1].calls / R.events > 0.6) F.push(`${Math.round(100 * fold[1].calls / R.events)}% of calls came from one folder (${fold[0]}): that is where to trim AGENTS.md, skills and MCP servers first.`);
  if (R.startMedian > 25000) F.push(`a brand-new session already carries about ${R.startMedian.toLocaleString("en-US")} tokens before you type anything (instructions, AGENTS.md, skills, tools). That cost repeats on every call of every session.`);
  if (limit === null) F.push("no model_auto_compact_token_limit is set in your Codex config.toml, so Codex lets context grow until its own very large limit.");
  else if (limit && R.ctxStats.p90 > limit * 1.5) F.push(`your Codex config says to compact at ${limit.toLocaleString("en-US")} tokens, but 1 in 10 calls carries more than ${R.ctxStats.p90.toLocaleString("en-US")}. The limit is not holding (the app or extension may ignore it, or the starting context is already above it).`);
  if (R.ctxStats.median > 60000) F.push(`median context per call is ${R.ctxStats.median.toLocaleString("en-US")} tokens (${Math.round(100 * R.ctxStats.over100k)}% of calls above 100k). Big context multiplies every call: keep AGENTS.md small, fewer MCP servers/skills, /new between tasks, compact earlier.`);
  const t = R.tok, tot = t.fresh + t.cached + t.output; if (tot && t.output / tot > 0.15) F.push(`output (including reasoning) is ${Math.round(100 * t.output / tot)}% of tokens, which is unusually high and is the expensive kind: lower reasoning effort.`);
  const src = top("source").filter(([k]) => /exec|cloud|automation|api/i.test(k)); const srcWk = src.reduce((a, [, v]) => a + v.wk, 0); if (hasPct && srcWk / R.wkTotal > 0.25) F.push(`${Math.round(100 * srcWk / R.wkTotal)}% came from non-interactive runs (${src.map(([k]) => k).join(", ")}): codex exec, automations or tools that call Codex for you (e.g. the codex-review / codex-dispatch plugins).`);
  return F;
}
export function format(R, days, lim) {
  const n = (x) => Math.round(x).toLocaleString("en-US"), o = [], M = (s) => o.push("measured  " + s), top = (g, k = 5) => Object.entries(R.by[g]).sort((a, b) => b[1].wk - a[1].wk || b[1].calls - a[1].calls).slice(0, k);
  o.push(`CODEX diagnose: last ${days} days, local logs only, read-only`);
  if (!R.events) { o.push("  no Codex token events found (run this on the PC where Codex runs; CODEX_HOME if it is not ~/.codex)."); return o.join("\n"); }
  M(`${R.files.size} sessions, ${R.events} calls; weekly % that moved: ${R.wkTotal.toFixed(1)} points, 5-hour % that moved: ${R.h5Total.toFixed(1)} points`);
  M(`new-session starting context: about ${n(R.startMedian)} tokens`);
  M(`tokens: fresh input ${n(R.tok.fresh)}, cached input ${n(R.tok.cached)}, output ${n(R.tok.output)} (of which reasoning ${n(R.tok.reasoning)}); context per call: median ${n(R.ctxStats.median)}, p90 ${n(R.ctxStats.p90)}`);
  const sect = (title, g, label) => { o.push(`  ${title}:`); for (const [k, v] of top(g)) o.push(`    ${v.wk.toFixed(1).padStart(5)} wk-pts ${String(v.calls).padStart(5)} calls  ${(label ? label(k) : k).slice(0, 70)}`); };
  sect("by session", "session"); sect("by model/effort", "lane"); sect("by day", "day"); sect("by folder", "folder"); sect("by how it was started", "source");
  const F = findings(R, lim); o.push(F.length ? "what stands out:" : "nothing stands out."); for (const f of F) o.push("  - " + f);
  return o.join("\n");
}
export function topFolders(R, k = 3) { return Object.entries(R.by.folder).filter(([f]) => f && f !== "?").sort((a, b) => b[1].calls - a[1].calls).slice(0, k).map(([f, v]) => ({ folder: f, calls: v.calls })); }
export function diagnose({ days = 7, home = codexHome(), now = Date.now() } = {}) { const R = analyze(collect(home, days, now)); const lim = compactLimit(home); const weights = topFolders(R).map((x) => ({ ...x, ...startupWeight(x.folder, home) }));
  let text = format(R, days, lim);
  if (R.events && weights.length) { const o = ["  what a new session loads in your busiest folders (measured from files on this PC):"]; for (const w of weights) o.push(`    ${w.folder.slice(0, 60)}: AGENTS.md files about ${w.agentsTokens.toLocaleString("en-US")} tokens${w.files.length ? ` (${w.files.map((x) => path.basename(path.dirname(x.f)) + "/" + path.basename(x.f) + " " + x.tokens.toLocaleString("en-US")).join(", ")})` : " (none found)"}; ${w.skillCount} skills visible`); text += "\n" + o.join("\n"); }
  const F = findings(R, lim); for (const w of weights) if (w.agentsTokens > 4000) F.push(`${path.basename(w.folder)}: its AGENTS.md files add about ${w.agentsTokens.toLocaleString("en-US")} tokens to every call of every session there. Trim them to the rules that really change behaviour.`); else if (w.skillCount > 40) F.push(`${path.basename(w.folder)}: ${w.skillCount} skills are visible to Codex there; each adds its description to every session. Keep only the ones you use in that project.`);
  return { R, text, findings: F, compactLimit: lim, weights }; }
if (process.argv[1]?.endsWith("codex-diagnose.mjs")) { const a = process.argv.slice(2), i = a.indexOf("--days"); console.log(diagnose({ days: i < 0 ? 7 : Number(a[i + 1]) || 7 }).text); }
