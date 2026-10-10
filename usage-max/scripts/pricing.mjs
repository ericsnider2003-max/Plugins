// List prices per million tokens (platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-07).
// Claude Code writes 1-hour cache entries on subscriptions, so writes are priced at the 1h rate.
const TABLE = [
  { match: /fable/, input: 10, write1h: 20, write5m: 12.5, read: 0.25, output: 50 },
  { match: /opus-5-5/, input: 4, write1h: 8, write5m: 5, read: 0.2, output: 20 },
  { match: /opus-5(?!-)/, input: 4, write1h: 8, write5m: 5, read: 0.4, output: 20, approx: true },
  { match: /opus-4/, input: 5, write1h: 10, write5m: 6.25, read: 0.5, output: 25, approx: true },
  { match: /sonnet-5-5/, input: 2, write1h: 4, write5m: 2.5, read: 0.2, output: 10 },
  { match: /sonnet/, input: 3, write1h: 6, write5m: 3.75, read: 0.3, output: 15, approx: true },
  { match: /haiku-4-5/, input: 1, write1h: 2, write5m: 1.25, read: 0.1, output: 5 },
  { match: /haiku/, input: 1, write1h: 2, write5m: 1.25, read: 0.1, output: 5, approx: true } // haiku-5-5 etc: Haiku 4.5 rates until confirmed
];
export function priceFor(model) {
  const name = String(model || "").toLowerCase();
  return TABLE.find((p) => p.match.test(name)) || null;
}
// Cache-write cost honouring the real 5m/1h split when the transcript carries it (else everything at the 1h rate).
export const writeCost = (u, p) => (u.created5m || u.created1h ? u.created5m * p.write5m + (u.created - u.created5m) * p.write1h : u.created * p.write1h);
export function turnCost(u, p) {
  if (!p) return { total: 0, read: 0, write: 0, output: 0, input: 0 };
  const read = (u.read * p.read) / 1e6, write = writeCost(u, p) / 1e6, output = (u.output * p.output) / 1e6, input = (u.input * p.input) / 1e6;
  return { total: read + write + output + input, read, write, output, input };
}

// Replay one session's main-loop turns under a 5-minute cache. Turns after a gap of 5-60 min would have
// missed (prefix re-written instead of read); every write is billed at the 5m rate instead of 1h.
// Returns { actual, sim5m } in USD. turns: [{ t, u, p }] sorted by time; u = normalizeUsage output.
export function replayTtl(turns) {
  let actual = 0, sim5m = 0, prevT = null;
  for (const { t, u, p } of turns) {
    if (!p) continue;
    const base = (u.output * p.output + u.input * p.input) / 1e6;
    actual += base + (writeCost(u, p) + u.read * p.read) / 1e6;
    const gap = prevT === null ? 0 : t - prevT;
    const miss = gap > 5 * 60000 && gap <= 60 * 60000;
    sim5m += base + (miss ? ((u.created + u.read) * p.write5m) / 1e6 : (u.created * p.write5m + u.read * p.read) / 1e6);
    prevT = t;
  }
  return { actual, sim5m };
}

// Cost of one assistant message at list price, honouring the real 5m/1h cache-write split when present.
export function recordCost(message) {
  const p = priceFor(message && message.model);
  const u = (message && message.usage) || {};
  if (!p || message.model === "<synthetic>") return 0;
  const cc = u.cache_creation || {};
  const w5 = Number(cc.ephemeral_5m_input_tokens) || 0;
  const w1 = Number(cc.ephemeral_1h_input_tokens) || 0;
  const created = Number(u.cache_creation_input_tokens) || 0;
  const unsplit = Math.max(created - w5 - w1, 0);
  return ((Number(u.input_tokens) || 0) * p.input + w5 * p.write5m + (w1 + unsplit) * p.write1h +
    (Number(u.cache_read_input_tokens) || 0) * p.read + (Number(u.output_tokens) || 0) * p.output) / 1e6;
}
