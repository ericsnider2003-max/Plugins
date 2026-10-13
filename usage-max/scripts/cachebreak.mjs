// Cache-break detector. Pure functions (no file or network access) used by `usage-max diagnose`.
// A "cache break": a turn whose cache_read falls to (near) 0 while a large amount is written to the cache (>= 20k tokens), right after a turn that read a lot (>= 20k).
// That means the saved start of the conversation had to be stored again, which costs the cache-write price instead of the (much lower) cache-read price.
// What is MEASURED: the token pattern, the gap between turns, the model names. What is INFERRED: the cause (the list below, from facts in the transcript only).
// What is an ESTIMATE: the extra cost (re-written tokens x (write price - read price), list price; a yardstick, not a bill).
import { priceFor, writeCost } from "./pricing.mjs";

export const BIG_TOKENS = 20000;
export const NEAR_ZERO_SHARE = 0.05; // "near 0": at most 5% of what the previous turn read
export const DROP_SHARE = 0.5; // context shrank to under half of the previous turn: a compaction
export const TTL_5M = 5 * 60000;
export const TTL_1H = 60 * 60000;

export const CAUSES = {
  idle: "idle longer than the cache lifetime",
  model: "model switch",
  compaction: "compaction",
  unexplained: "unexplained (something changed the start of the conversation: edited CLAUDE.md, changed tools/MCP servers, or changed settings)"
};

export function adviceFor(cause, ttlMs = TTL_5M) {
  if (cause === "idle") return `idle gaps: send a short message before the ${ttlMs >= TTL_1H ? "1-hour" : "5-minute"} mark or accept the one-time cost.`;
  if (cause === "model") return "model switches: avoid changing models mid-session; start a new session for a different model.";
  if (cause === "compaction") return "compaction: expected after /compact or auto-compaction (the shorter conversation is stored once); nothing to fix unless it happens often.";
  return "unexplained: avoid editing CLAUDE.md or switching tools/models mid-session.";
}

// turns: one transcript's main-loop assistant turns in time order.
//   { t (ms), model, u (normalizeUsage output), oneHour (bool: the raw usage said cache writes were ephemeral_1h), boundaryBefore (bool: a compaction/summary record sits between the previous turn and this one) }
// Returns { count, extraCost, byCause, breaks, top, unpriced }.
export function detectCacheBreaks(turns, { bigTokens = BIG_TOKENS } = {}) {
  const breaks = []; let unpriced = 0, sawOneHour = false;
  for (let i = 0; i < turns.length; i++) {
    const cur = turns[i], prev = i ? turns[i - 1] : null;
    if (prev && prev.oneHour) sawOneHour = true;
    if (!prev) continue;
    const isBreak = prev.u.read >= bigTokens && cur.u.created >= bigTokens && cur.u.read <= prev.u.read * NEAR_ZERO_SHARE;
    if (!isBreak) continue;
    const ttlMs = sawOneHour ? TTL_1H : TTL_5M, gapMs = cur.t && prev.t ? cur.t - prev.t : 0;
    const ctx = (u) => u.input + u.created + u.read;
    let cause;
    if (gapMs > ttlMs) cause = "idle";
    else if (cur.model !== prev.model) cause = "model";
    else if (cur.boundaryBefore || ctx(cur.u) < ctx(prev.u) * DROP_SHARE) cause = "compaction";
    else cause = "unexplained";
    const rewritten = Math.min(cur.u.created, prev.u.read + prev.u.created); // cannot have re-written more than was cached before
    const p = priceFor(cur.model, ctx(cur.u));
    let extraCost = 0;
    if (p && cur.u.created > 0) extraCost = Math.max(0, (rewritten * (writeCost(cur.u, p) / cur.u.created - p.read)) / 1e6); else unpriced++;
    breaks.push({ index: i, t: cur.t, cause, causeText: CAUSES[cause], model: cur.model, prevModel: prev.model, gapMs, ttlMs, rewritten, extraCost });
  }
  return summarize(breaks, unpriced);
}

export function summarize(breaks, unpriced = 0) {
  const byCause = {}; let extraCost = 0;
  for (const b of breaks) { const c = (byCause[b.cause] = byCause[b.cause] || { count: 0, extraCost: 0, ttlMs: b.ttlMs }); c.count++; c.extraCost += b.extraCost; extraCost += b.extraCost; }
  const top = [...breaks].sort((a, b) => b.extraCost - a.extraCost || a.t - b.t).slice(0, 3);
  return { count: breaks.length, extraCost, byCause, breaks, top, unpriced };
}

// Merge results of several transcripts (each break may carry a `file`).
export function mergeBreaks(results) {
  return summarize(results.flatMap((r) => r.breaks), results.reduce((a, r) => a + r.unpriced, 0));
}

const usd = (x) => `$${x.toFixed(2)}`;
const k = (n) => `${Math.round(n / 1000)}k`;
export function formatCacheBreaks(r, { when = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC", where = (b) => b.file || "" } = {}) {
  if (!r.count) return ["cache breaks: none found (no turn dropped from a big cache read to a big cache re-write)."];
  const o = [`cache breaks (MEASURED token pattern; the cause is INFERRED from the transcript; extra cost is an ESTIMATE at list price): ${r.count}, about ${usd(r.extraCost)} extra versus a cache hit`];
  for (const [c, v] of Object.entries(r.byCause).sort((a, b) => b[1].extraCost - a[1].extraCost)) o.push(`  ${v.count} x ${CAUSES[c]}: about ${usd(v.extraCost)}`);
  o.push("  largest:");
  for (const b of r.top) o.push(`    ${when(b.t)}  ${b.causeText.split(" (")[0]}  re-wrote ${k(b.rewritten)} tokens, about ${usd(b.extraCost)} extra${where(b) ? "  " + where(b) : ""}`);
  o.push("  what to do:");
  for (const c of Object.keys(r.byCause)) o.push(`    - ${adviceFor(c, r.byCause[c].ttlMs)}`);
  if (r.unpriced) o.push(`  (${r.unpriced} break(s) had a model with no price, so their cost is not included)`);
  return o;
}
