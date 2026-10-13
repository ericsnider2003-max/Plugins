#!/usr/bin/env node
// Burn-anomaly alarm for BOTH plans. Compares the recent burn rate with your own hourly median and names the biggest contributor.
// Read-only, local logs only. Claude is measured in list-price dollars; Codex has no price in its logs, so it is measured in tokens (input-cached + output).
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { listJsonlFiles, normalizeUsage, parseTimestamp, createDeduper } from "./lib.mjs";
import { priceFor, turnCost } from "./pricing.mjs";

const HOUR = 36e5;
// events: [{ t, v, who }]. Returns null (not enough history) or { recent, median, factor, top, anomalous }.
export function detect(events, { now = Date.now(), recentHours = 3, days = 7, factor = 3, minHours = 24 } = {}) {
  const lo = now - days * 24 * HOUR, cut = now - recentHours * HOUR, hours = new Map(), recentBy = {};
  let recent = 0;
  for (const e of events) {
    if (e.t < lo || e.t > now) continue;
    if (e.t >= cut) { recent += e.v; recentBy[e.who] = (recentBy[e.who] || 0) + e.v; continue; }
    const h = Math.floor(e.t / HOUR); hours.set(h, (hours.get(h) || 0) + e.v);
  }
  if (hours.size < minHours) return null; // fewer than ~a day of active hours: no honest baseline
  const vals = [...hours.values()].sort((a, b) => a - b), median = vals[Math.floor(vals.length / 2)], rate = recent / recentHours;
  const top = Object.entries(recentBy).sort((a, b) => b[1] - a[1])[0] || null;
  return { rate, median, ratio: median > 0 ? rate / median : null, top: top && { who: top[0], share: top[1] / (recent || 1) }, anomalous: median > 0 && rate > median * factor, baselineHours: hours.size };
}

export async function claudeEvents(dir, days = 7, now = Date.now()) {
  const dedupe = createDeduper(), lo = now - days * 864e5; // one message repeated across files counts once, at its largest output
  for (const f of await listJsonlFiles(dir)) {
    let text; try { if (fs.statSync(f).mtimeMs < lo) continue; text = fs.readFileSync(f, "utf8"); } catch { continue; }
    const side = f.includes("/subagents/") || f.includes(`${path.sep}subagents${path.sep}`), label = (side ? "subagent " : "main ") + path.basename(f).slice(0, 8);
    for (const line of text.split("\n")) {
      if (!line.includes('"assistant"')) continue; let r; try { r = JSON.parse(line); } catch { continue; }
      const m = r && r.message; if (r.type !== "assistant" || !m || !m.model || m.model === "<synthetic>") continue;
      dedupe.add(m, { m, t: parseTimestamp(r.timestamp), who: `${label} (${m.model})` });
    }
  }
  const ev = [];
  for (const { m, t, who } of dedupe.items()) {
    const u = normalizeUsage(m.usage), p = priceFor(m.model, u.input + u.created + u.read); if (!t || !p) continue;
    ev.push({ t, v: turnCost(u, p).total, who });
  }
  return ev;
}
export function codexEvents(home, days = 7, now = Date.now()) {
  const ev = [], lo = now - days * 864e5, root = path.join(home, "sessions");
  const walk = (d) => { let o = []; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) o = o.concat(walk(f)); else if (e.name.endsWith(".jsonl")) o.push(f); } } catch {} return o; };
  for (const f of walk(root)) {
    let text, model = "?", effort = "?"; try { if (fs.statSync(f).mtimeMs < lo) continue; text = fs.readFileSync(f, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } const p = o.payload && typeof o.payload === "object" ? o.payload : o;
      if (o.type === "turn_context" || p.type === "turn_context") { model = p.model || model; effort = p.effort || p.reasoning_effort || effort; }
      if (p.type === "token_count") { const u = (p.info || p).last_token_usage; const t = Date.parse(o.timestamp || p.timestamp); if (u && t) ev.push({ t, v: Math.max((u.input_tokens || 0) - (u.cached_input_tokens || 0), 0) + (u.output_tokens || 0), who: `${path.basename(f).slice(0, 24)} (${model}/${effort})` }); }
    }
  }
  return ev;
}
export function format(name, unit, r) {
  if (!r) return `${name}: not enough history yet for a baseline (needs about a day of activity).`;
  const f = (x) => (unit === "$" ? `$${x.toFixed(2)}` : Math.round(x).toLocaleString("en-US"));
  const base = `${name}: last 3h ${f(r.rate)}/h vs your usual ${f(r.median)}/h (${r.ratio ? r.ratio.toFixed(1) + "x" : "n/a"}, ${r.baselineHours} active hours of baseline)`;
  if (!r.anomalous) return base + " - normal.";
  return `${base} - BURNING FAST.${r.top ? ` ${Math.round(100 * r.top.share)}% of it is ${r.top.who}.` : ""} Check for a loop or stuck task, a higher model/effort, Fast mode, or a plugin that started spending.`;
}
export async function report(home = process.env.USAGE_MAX_HOME || os.homedir()) {
  const c = detect(await claudeEvents(path.join(home, ".claude", "projects")));
  const x = detect(codexEvents(process.env.CODEX_HOME || path.join(home, ".codex")));
  return { claude: c, codex: x, text: ["measured  " + format("Claude", "$", c), "measured  " + format("Codex", "tok", x)].join("\n") };
}
if (process.argv[1]?.endsWith("anomaly.mjs")) { const r = await report(); console.log(r.text); }
