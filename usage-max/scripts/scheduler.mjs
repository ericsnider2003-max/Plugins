// Reset-aware wake calculation. It never polls or starts work.
import { EVIDENCE_FRESHNESS_MS } from "./timing.mjs";
export function nextWake({ observation = null, now = Date.now(), minimumDelayMs = 60000, maxDelayMs = 24 * 3600000, maxAgeMs = EVIDENCE_FRESHNESS_MS } = {}) {
  const capturedAt = Date.parse(observation?.capturedAt || 0);
  const age = now - capturedAt;
  if (!observation || observation.state === "unavailable" || observation.state === "quarantined" || observation.authority !== "provider" || observation.freshness !== "fresh" || !Number.isFinite(capturedAt) || age < 0 || age > maxAgeMs) return { state: "needs-observation", wakeAt: new Date(now + minimumDelayMs).toISOString(), reason: "verified fresh provider reset time is unavailable" };
  const reset = Date.parse(observation.window?.resetsAt || 0);
  if (!Number.isFinite(reset) || reset <= now) return { state: "refresh", wakeAt: new Date(now + minimumDelayMs).toISOString(), reason: "window is ready for a fresh observation" };
  return { state: "waiting-for-reset", wakeAt: new Date(Math.min(reset + minimumDelayMs, now + maxDelayMs)).toISOString(), reason: "wait for the verified provider window" };
}
