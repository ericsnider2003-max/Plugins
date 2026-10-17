// Stable provider-window shape fingerprints. A changed window meaning is
// quarantined instead of being merged into the account ledger as if it were
// the same allowance bucket.
const numberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function limitShape(capture) {
  const limits = capture?.rate_limits || capture?.rateLimits || {};
  return Object.entries(limits).map(([key, value]) => ({
    key,
    label: typeof value?.label === "string" ? value.label : null,
    windowMinutes: numberOrNull(value?.window_minutes ?? value?.windowMinutes),
  })).sort((a, b) => a.key.localeCompare(b.key));
}

export function shapeSignature(capture) { return JSON.stringify(limitShape(capture)); }

export function compareLimitShape(previous, current) {
  if (!previous || !current) return { changed: false, reason: null, previous: limitShape(previous), current: limitShape(current) };
  const before = shapeSignature(previous); const after = shapeSignature(current);
  return { changed: before !== after, reason: before === after ? null : "shape_changed", previous: limitShape(previous), current: limitShape(current) };
}
