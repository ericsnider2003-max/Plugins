// Safe admission decision. It never starts a worker and never changes a model/account.
import { dependencyDecision, retryDecision } from "./task-policy.mjs";
import { EVIDENCE_FRESHNESS_MS } from "./timing.mjs";
import { predictiveDecision } from "./predictive-budget.mjs";
export function canAdmit({ task, observation, accountApproved = false, reservePercent = 10, now = Date.now(), maxAgeMs = EVIDENCE_FRESHNESS_MS, tasks = new Map(), requireKnownModel = true, activeTaskCount = null, previousObservation = null, observationHistory = [] }) {
  if (!task?.taskId) return { allowed: false, reason: "task identity is missing" };
  const deps = dependencyDecision(task, tasks); if (!deps.allowed) return { allowed: false, reason: deps.reason, missingDependencies: deps.missing };
  if (task.state === "failed") { const retry = retryDecision(task, { now }); if (!retry.allowed) return { allowed: false, reason: retry.reason, retryAt: retry.retryAt }; }
  if (task.deadlineAt && (!Number.isFinite(Date.parse(task.deadlineAt)) || Date.parse(task.deadlineAt) <= now)) return { allowed: false, reason: "task deadline has expired", deadlineAt: task.deadlineAt };
  const limit = Number(task.maxConcurrency);
  if (Number.isFinite(limit) && limit > 0 && Number(activeTaskCount) >= limit) return { allowed: false, reason: "task concurrency limit is active", activeTaskCount: Number(activeTaskCount), maxConcurrency: limit };
  if (!accountApproved) return { allowed: false, reason: "account is not approved and enabled" };
  if (!observation) return { allowed: false, reason: "no usage observation" };
  if (observation.state !== "governing") return { allowed: false, reason: `observation is ${observation.state || "unknown"}` };
  if (observation.authority !== "provider") return { allowed: false, reason: "provider-authoritative allowance is unavailable" };
  if (observation.freshness !== "fresh") return { allowed: false, reason: "usage observation is stale or unknown" };
  if (observation.model?.raw && observation.model?.provider === "unknown") return { allowed: false, reason: "model/provider attribution conflict" };
  if (observation.model?.provider && observation.model.provider !== "unknown" && observation.model.provider !== observation.provider) return { allowed: false, reason: "model/provider attribution conflict" };
  if (requireKnownModel && observation.model?.known !== true) return { allowed: false, reason: "known model identity is required for unattended admission" };
  const observedModel = observation.model?.canonical || observation.model?.raw || null;
  if (task.requestedModel && observedModel !== task.requestedModel) return { allowed: false, reason: "requested model is not the active observed model" };
  if (task.requestedEffort && observation.model?.effort !== task.requestedEffort) return { allowed: false, reason: observation.model?.effort ? "requested effort is not the active observed effort" : "requested effort is unknown" };
  const age = now - Date.parse(observation.capturedAt || 0);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return { allowed: false, reason: "usage observation is stale or invalid" };
  const pct = Number(observation.window?.usedPercentage);
  if (!Number.isFinite(pct)) return { allowed: false, reason: "quota percentage is unknown" };
  if (pct >= 100 - reservePercent) return { allowed: false, reason: "reserved capacity is not available" };
  const predictive = predictiveDecision({ task, observation, previousObservation, observationHistory, reservePercent });
  if (!predictive.allowed) return { allowed: false, reason: predictive.reason, prediction: predictive.prediction };
  return { allowed: true, reason: "fresh provider allowance and approved account", remainingPercent: 100 - pct, prediction: predictive.prediction };
}
