// Ported from Umbrella Project skills/usage-max/provider-observation.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function isoFromUnixSeconds(value, name) {
  assert(Number.isFinite(value) && value > 0, `${name} must be a positive Unix timestamp`);
  const timestamp = new Date(value * 1000);
  assert(Number.isFinite(timestamp.getTime()), `${name} must be a valid timestamp`);
  return timestamp.toISOString();
}

/**
 * Convert the native Codex app-server allowance response into the narrow
 * provider-observation shape consumed by the Umbrella controller. The caller
 * must supply the capture time and the approved account slot; neither is
 * inferred from the payload. Credentials and provider account identifiers are
 * deliberately discarded.
 */
export function normalizeCodexAppLimits(raw, {
  accountSlot,
  capturedAt,
  now = capturedAt,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  assert(raw && typeof raw === 'object', 'raw Codex limits are required');
  assert(typeof accountSlot === 'string' && accountSlot.length > 0, 'approved accountSlot is required');
  assert(Number.isFinite(maxAgeMs) && maxAgeMs >= 0, 'maxAgeMs must be non-negative');
  const captured = Date.parse(capturedAt ?? '');
  const current = Date.parse(now ?? '');
  assert(Number.isFinite(captured), 'capturedAt must be a valid timestamp');
  assert(Number.isFinite(current) && current >= captured, 'now must be a valid timestamp at or after capturedAt');

  const limits = raw.rateLimitsByLimitId?.codex ?? raw.rateLimits;
  const primary = limits?.primary;
  assert(primary && typeof primary === 'object', 'Codex primary rate-limit window is required');
  const usedPercentage = Number(primary.usedPercent);
  assert(Number.isFinite(usedPercentage) && usedPercentage >= 0 && usedPercentage <= 100, 'usedPercent must be between 0 and 100');
  const windowDurationMins = Number(primary.windowDurationMins);
  assert(Number.isFinite(windowDurationMins) && windowDurationMins > 0, 'windowDurationMins must be positive');
  const resetsAt = isoFromUnixSeconds(Number(primary.resetsAt), 'resetsAt');
  const ageMs = current - captured;
  const state = ageMs <= maxAgeMs ? 'fresh' : 'stale';

  return {
    state,
    authority: 'provider',
    source: 'codex-app:get_usage_limits',
    provider: 'openai',
    surface: 'codex-desktop',
    accountSlot,
    capturedAt: new Date(captured).toISOString(),
    now: new Date(current).toISOString(),
    maxAgeMs,
    freshness: state === 'fresh' ? 'fresh' : 'stale',
    remainingFraction: (100 - usedPercentage) / 100,
    window: {
      id: limits.limitId ?? 'codex',
      usedPercentage,
      resetsAt,
      windowDurationMins,
    },
    ordinaryUsageAllowed: raw.ordinaryUsageAllowed === true,
    spendControlReached: raw.rateLimits?.spendControlReached === true,
  };
}

