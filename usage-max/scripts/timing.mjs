// Shared observation timing policy. Keep the collection cadence comfortably
// inside the freshness boundary so scheduler jitter cannot make normal captures
// stale before the next tick.
export const DEFAULT_OBSERVATION_INTERVAL_MS = 5 * 60 * 1000;
export const EVIDENCE_FRESHNESS_MS = 15 * 60 * 1000;
