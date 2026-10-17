// Predictive next-step budget estimates are planning evidence, never provider authority.
const finitePercent = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
function positiveDelta(previous, current) { const before = finitePercent(previous?.window?.usedPercentage); const after = finitePercent(current?.window?.usedPercentage); if (before === null || after === null || after < before) return null; return after - before; }
export function estimateNextStep({ task = {}, observation = null, previousObservation = null, observationHistory = [], reservePercent: reserveOverride = null } = {}) {
  const reservePercent = finitePercent(reserveOverride) ?? finitePercent(task?.budgetPolicy?.reservePercent) ?? 10;
  const remainingPercent = finitePercent(observation?.window?.usedPercentage);
  const headroom = remainingPercent === null ? null : Math.max(0, 100 - reservePercent - remainingPercent);
  const explicit = finitePercent(task?.budgetPolicy?.expectedStepPercent);
  const recent = [positiveDelta(previousObservation, observation), ...(Array.isArray(observationHistory) ? observationHistory.slice(-8).map((item, index, list) => positiveDelta(list[index - 1], item)) : [])].filter((value) => value !== null && value > 0);
  const estimate = explicit ?? (recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : null);
  const source = explicit !== null ? "task-policy" : estimate !== null ? "observed-delta" : "unknown";
  const confidence = explicit !== null ? "declared" : recent.length >= 2 ? "measured" : estimate !== null ? "single-observed-delta" : "unknown";
  return { known: estimate !== null, estimatedStepPercent: estimate, reservePercent, remainingPercent, headroom, source, confidence, fits: estimate !== null && headroom !== null && estimate <= headroom };
}
export function predictiveDecision({ task = {}, observation, previousObservation = null, observationHistory = [], reservePercent = null } = {}) {
  const policy = task?.budgetPolicy || {}; const prediction = estimateNextStep({ task, observation, previousObservation, observationHistory, reservePercent });
  if (policy.requirePrediction === true && !prediction.known) return { allowed: false, reason: "next-step usage prediction is unavailable", prediction };
  if (prediction.known && Number.isFinite(Number(policy.maxStepPercent)) && prediction.estimatedStepPercent > Number(policy.maxStepPercent)) return { allowed: false, reason: "predicted next step exceeds task step budget", prediction };
  if (prediction.known && !prediction.fits) return { allowed: false, reason: "predicted next step would consume protected capacity", prediction };
  return { allowed: true, reason: prediction.known ? "predicted next step fits protected capacity" : "no predictive policy required", prediction };
}
