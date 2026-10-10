#!/usr/bin/env node
// Where does plan usage go? Prices every assistant turn at list price (Claude Code's own /usage basis;
// plan limits are not published per token, so list price is the proxy) and decomposes the cost into
// levers you can pull. Local transcripts only. No model calls.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listJsonlFiles, normalizeUsage, parseTimestamp } from "./lib.mjs";
import { priceFor, turnCost, replayTtl } from "./pricing.mjs";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || !process.argv[i + 1] || process.argv[i + 1].startsWith("--") ? fallback : process.argv[i + 1];
}
const home = process.env.USAGE_MAX_HOME || os.homedir();
const dir = arg("projects-dir", path.join(home, ".claude", "projects"));
const days = Number(arg("days", 7));
const since = Date.now() - days * 86400000;
const IDLE_MS = Number(arg("idle-minutes", 60)) * 60000;
const windows = [100000, 150000, 200000, 300000, 400000];

const totals = { cost: 0, read: 0, write: 0, output: 0, input: 0, turns: 0 };
const byModel = {};
const scope = { hub: 0, subagent: 0 };
const ctxSamples = [];
const capSavings = Object.fromEntries(windows.map((w) => [w, 0]));
let idleMissCost = 0, idleMisses = 0, firstTurnCtx = [], unknownModels = new Set();
const sessions = {};
const ttl = { actual: 0, sim5m: 0, byProject: {} };
let baselineTokens = [], mainTurns = 0;

for (const file of await listJsonlFiles(dir)) {
  const recs = [];
  const seenIds = new Set(); // one transcript record per content block repeats the same usage
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"assistant"')) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== "assistant" || !r.message || !r.message.model || r.message.model === "<synthetic>") continue;
    if (r.message.id) { if (seenIds.has(r.message.id)) continue; seenIds.add(r.message.id); }
    const t = parseTimestamp(r.timestamp);
    if (t && t < since) continue;
    recs.push({ t, model: r.message.model, u: normalizeUsage(r.message.usage), side: r.isSidechain === true || file.includes(`${path.sep}subagents${path.sep}`) || file.includes("/subagents/") });
  }
  recs.sort((a, b) => a.t - b.t);
  const mainRecs = recs.filter((r) => !r.side).map((r) => ({ t: r.t, u: r.u, p: priceFor(r.model) }));
  if (mainRecs.length) {
    const rep = replayTtl(mainRecs);
    const proj = path.basename(path.dirname(file));
    ttl.actual += rep.actual; ttl.sim5m += rep.sim5m;
    const b = (ttl.byProject[proj] = ttl.byProject[proj] || { sessions: 0, actual: 0, sim5m: 0 });
    b.sessions += 1; b.actual += rep.actual; b.sim5m += rep.sim5m;
    mainTurns += mainRecs.length;
  }
  let prevT = 0, first = true;
  for (const r of recs) {
    const p = priceFor(r.model);
    if (!p) unknownModels.add(r.model);
    const c = turnCost(r.u, p);
    const ctx = r.u.input + r.u.created + r.u.read;
    totals.cost += c.total; totals.read += c.read; totals.write += c.write; totals.output += c.output; totals.input += c.input; totals.turns += 1;
    const m = (byModel[r.model] = byModel[r.model] || { turns: 0, cost: 0, output: 0, read: 0, write: 0 });
    m.turns += 1; m.cost += c.total; m.output += c.output; m.read += c.read; m.write += c.write;
    scope[r.side ? "subagent" : "hub"] += c.total;
    sessions[file] = (sessions[file] || 0) + c.total;
    if (!r.side) {
      ctxSamples.push(ctx);
      if (first) { firstTurnCtx.push(ctx); first = false; }
      // Cap what-if: a turn whose context exceeds W would have re-read at most ~W after compaction.
      for (const w of windows) if (ctx > w && p) capSavings[w] += ((ctx - w) / ctx) * c.read;
      // Idle miss: >IDLE since previous turn and most of the context re-written instead of read.
      if (prevT && r.t - prevT > IDLE_MS && r.u.created > 0.5 * ctx && ctx > 20000) { idleMisses += 1; idleMissCost += c.write; }
      prevT = r.t;
    }
  }
}

const pct = (x) => (totals.cost ? ((100 * x) / totals.cost).toFixed(1) : "0.0") + "%";
const usd = (x) => `$${x.toFixed(2)}`;
const q = (arr, f) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const k = (n) => `${Math.round(n / 1000)}k`;

const report = {
  windowDays: days, turns: totals.turns, listPriceCost: totals.cost,
  breakdown: { cacheReads: totals.read, cacheWrites: totals.write, output: totals.output, uncachedInput: totals.input },
  scope, byModel,
  hubContext: { p50: q(ctxSamples, 0.5), p90: q(ctxSamples, 0.9), p99: q(ctxSamples, 0.99), max: q(ctxSamples, 1), over200k: ctxSamples.filter((c) => c > 200000).length, turns: ctxSamples.length },
  sessionStartContext: { median: q(firstTurnCtx, 0.5), sessions: firstTurnCtx.length },
  idleMisses: { count: idleMisses, writeCost: idleMissCost },
  autoCompactCapSavings: capSavings,
  unknownModels: [...unknownModels],
  ttlReplay: ttl
};
if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

console.log(`usage-max diagnose — last ${days}d, ${totals.turns} turns, ${usd(totals.cost)} at list price (proxy for plan usage)`);
console.log(`  cache reads (re-sending context): ${usd(totals.read)} ${pct(totals.read)}`);
console.log(`  cache writes (new context + misses): ${usd(totals.write)} ${pct(totals.write)}`);
console.log(`  output (incl. thinking): ${usd(totals.output)} ${pct(totals.output)}`);
console.log(`  uncached input: ${usd(totals.input)} ${pct(totals.input)}`);
console.log(`by model:`);
for (const [m, b] of Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost)) console.log(`  ${m}: ${b.turns} turns ${usd(b.cost)} ${pct(b.cost)} (output ${usd(b.output)}, reads ${usd(b.read)}, writes ${usd(b.write)})`);
console.log(`main session vs subagents: ${usd(scope.hub)} ${pct(scope.hub)} / ${usd(scope.subagent)} ${pct(scope.subagent)}`);
console.log(`main-session context per turn: p50 ${k(report.hubContext.p50)} p90 ${k(report.hubContext.p90)} p99 ${k(report.hubContext.p99)} max ${k(report.hubContext.max)}; turns >200k: ${report.hubContext.over200k}/${report.hubContext.turns}`);
console.log(`session start overhead (first-turn context, median): ${k(report.sessionStartContext.median)} over ${report.sessionStartContext.sessions} sessions`);
console.log(`idle cache misses (>${IDLE_MS / 60000}min gap then full re-write): ${idleMisses}, ${usd(idleMissCost)} ${pct(idleMissCost)}`);
console.log(`auto-compact cap what-if (upper bound on cache-read savings):`);
for (const w of windows) console.log(`  cap ${k(w)}: save up to ${usd(capSavings[w])} ${pct(capSavings[w])}`);
// Ranked levers with estimated weekly savings at list price.
const baseline = report.sessionStartContext.median;
const baselineCost = (firstTurnCtx.length * baseline * 4) / 1e6 + (mainTurns * baseline * 0.2) / 1e6; // Sonnet/Opus 1h write $4-8, read $0.20
const ttlSave = ttl.actual - ttl.sim5m;
const projWins = Object.entries(ttl.byProject).map(([p, b]) => ({ p, sessions: b.sessions, save: b.actual - b.sim5m })).filter((x) => x.save > 0).sort((a, b) => b.save - a.save);
console.log(`levers (ranked, est. per ${days}d at list price):`);
const levers = [
  { name: "5-minute cache TTL where it is cheaper (replayed per session with real gaps)", save: projWins.reduce((a, x) => a + x.save, 0), note: `all sessions: ${usd(ttlSave)}; only the projects below: ${usd(projWins.reduce((a, x) => a + x.save, 0))}` },
  { name: `startup context (${k(baseline)}/session median) — every 10k cut`, save: (baselineCost * 10000) / Math.max(baseline, 1), note: `${firstTurnCtx.length} sessions, ${mainTurns} turns re-reading it` },
  { name: "output tokens (effort level / verbosity) — every 10% cut", save: totals.output * 0.1, note: `output is ${pct(totals.output)} of usage` },
  { name: "auto-compact window cap at 200k", save: capSavings[200000], note: `main-session p99 context ${k(report.hubContext.p99)}` },
  { name: "idle cache misses", save: idleMissCost, note: `${idleMisses} misses` }
].sort((a, b) => b.save - a.save);
for (const l of levers) console.log(`  ${usd(l.save).padStart(8)} ${pct(l.save).padStart(6)}  ${l.name} — ${l.note}`);
if (projWins.length) {
  console.log(`  projects where a 5m TTL is cheaper:`);
  for (const x of projWins.slice(0, 8)) console.log(`    ${usd(x.save).padStart(8)}  ${x.sessions} sessions  ${x.p}`);
}
if (unknownModels.size) console.log(`unpriced models (excluded from cost): ${[...unknownModels].join(", ")}`);
