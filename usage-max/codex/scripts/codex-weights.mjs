// Learn the relative plan cost of each Codex model from YOUR logs, instead of needing the rate card.
// Codex logs the real weekly % on every call, so for each model: plan points moved per million fresh-equivalent tokens
// (fresh input + 0.1 x cached + 5 x output, the same shape the governor uses). Percent steps are coarse, so a model needs real movement
// (>= 3 points over >= 20 calls) before it is reported. This is an ESTIMATE; the official rate card, if you have it, wins.
//   codex-weights.mjs [--days N]            report
//   codex-weights.mjs --apply               write the learned weights into config.json (cheapest model = 1)
import fs from "node:fs"; import path from "node:path";
import { dataDir, loadConfig, DEFAULT_CONFIG } from "./codex-governor.mjs";
import { collect } from "./codex-diagnose.mjs";
export function learn(events, { minPts = 3, minCalls = 20 } = {}) {
  const by = {}; let prev = null;
  for (const e of events) {
    let d = 0; if (e.wk != null) { if (prev != null && e.wk >= prev) d = e.wk - prev; prev = e.wk; }
    const b = (by[e.model] = by[e.model] || { pts: 0, tok: 0, calls: 0 }); b.pts += d; b.calls++; b.tok += Math.max(e.input - e.cached, 0) + 0.1 * e.cached + 5 * e.output;
  }
  const rows = Object.entries(by).filter(([m, b]) => m !== "?" && b.pts >= minPts && b.calls >= minCalls && b.tok > 0).map(([m, b]) => ({ model: m, ptsPerMTok: b.pts / (b.tok / 1e6), pts: b.pts, calls: b.calls }));
  if (!rows.length) return { rows: [], note: "not enough plan movement per model yet (needs >= 3 points over >= 20 calls each). Use Codex for a few more days." };
  const base = Math.min(...rows.map((r) => r.ptsPerMTok)); for (const r of rows) r.weight = Math.max(1, Math.round(r.ptsPerMTok / base));
  return { rows: rows.sort((a, b) => b.weight - a.weight), note: rows.length < 2 ? "only one model has enough data, so there is nothing to compare yet." : null };
}
export function format(r) { const o = ["estimate  relative plan cost per model, learned from your logs (cheapest = 1)"]; for (const x of r.rows) o.push(`  ${String(x.weight).padStart(4)}x  ${x.model}  (${x.pts.toFixed(1)} points over ${x.calls} calls)`); if (r.note) o.push("  " + r.note); return o.join("\n"); }
if (process.argv[1]?.endsWith("codex-weights.mjs")) {
  const a = process.argv.slice(2), i = a.indexOf("--days"), days = i < 0 ? 14 : Number(a[i + 1]) || 14, r = learn(collect(undefined, days)); console.log(format(r));
  if (a.includes("--apply")) {
    if (r.rows.length < 2) { console.log("not applied: need at least two models with enough data."); process.exit(1); }
    const f = path.join(dataDir(), "config.json"); let c = {}; try { c = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
    const learned = r.rows.map((x) => [x.model.toLowerCase(), x.weight]); c.weights = [...learned, ...(c.weights || DEFAULT_CONFIG.weights)];
    fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(f, JSON.stringify(c, null, 2)); console.log(`applied ${learned.length} weights to ${f} (they go first, your other weights stay)`);
  } else if (r.rows.length >= 2) console.log("apply them: usage-max codex weights --apply");
}
