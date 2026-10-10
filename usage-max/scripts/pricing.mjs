// List prices per million tokens (platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-07).
// Claude Code writes 1-hour cache entries on subscriptions, so writes are priced at the 1h rate.
const TABLE = [
  { match: /fable/, input: 10, write1h: 20, write5m: 12.5, read: 0.25, output: 50 },
  { match: /opus-5-5/, input: 4, write1h: 8, write5m: 5, read: 0.2, output: 20 },
  { match: /opus-5(?!-)/, input: 4, write1h: 8, write5m: 5, read: 0.4, output: 20, approx: true },
  { match: /opus-4/, input: 5, write1h: 10, write5m: 6.25, read: 0.5, output: 25, approx: true },
  { match: /sonnet-5-5/, input: 2, write1h: 4, write5m: 2.5, read: 0.2, output: 10 },
  { match: /sonnet/, input: 3, write1h: 6, write5m: 3.75, read: 0.3, output: 15, approx: true },
  { match: /haiku-4-5/, input: 1, write1h: 2, write5m: 1.25, read: 0.1, output: 5 }
];
export function priceFor(model) {
  const name = String(model || "").toLowerCase();
  return TABLE.find((p) => p.match.test(name)) || null;
}
export function turnCost(u, p) {
  if (!p) return { total: 0, read: 0, write: 0, output: 0, input: 0 };
  const read = (u.read * p.read) / 1e6, write = (u.created * p.write1h) / 1e6, output = (u.output * p.output) / 1e6, input = (u.input * p.input) / 1e6;
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
    actual += base + (u.created * p.write1h + u.read * p.read) / 1e6;
    const gap = prevT === null ? 0 : t - prevT;
    const miss = gap > 5 * 60000 && gap <= 60 * 60000;
    sim5m += base + (miss ? ((u.created + u.read) * p.write5m) / 1e6 : (u.created * p.write5m + u.read * p.read) / 1e6);
    prevT = t;
  }
  return { actual, sim5m };
}
