// Deterministic quality/time/usage policy. This selects a verification profile;
// it never changes credentials, provider settings, or acceptance criteria.
const profiles = {
  cheap: { verification: "targeted", retryBudget: "bounded", reason: "low-risk work with adequate headroom" },
  standard: { verification: "normal", retryBudget: "bounded", reason: "balanced quality, time, and usage" },
  thorough: { verification: "full", retryBudget: "bounded", reason: "higher rework or correctness risk" },
};

export function chooseExecutionProfile({ difficulty = "standard", reworkRisk = "standard", qualityRequired = "standard", remainingPercent = null, deadlineMs = null, requested = null } = {}) {
  const order = ["cheap", "standard", "thorough"];
  const rank = (value) => value === "low" || value === "cheap" ? 0 : value === "high" || value === "thorough" ? 2 : 1;
  const requestedRank = requested && order.includes(requested) ? order.indexOf(requested) : 0;
  let score = Math.max(rank(difficulty), rank(reworkRisk), rank(qualityRequired), requestedRank);
  const remaining = remainingPercent == null ? null : Number(remainingPercent);
  const deadline = deadlineMs == null ? null : Number(deadlineMs);
  const urgent = Number.isFinite(deadline) && deadline >= 0 && deadline < 60 * 60 * 1000;
  const constrained = Number.isFinite(remaining) && remaining < 20;
  // Scarcity may shorten scheduling/retry behavior, but never lowers required
  // verification or an explicit requested profile.
  if (constrained && score === 1 && !urgent && requestedRank < 1 && rank(qualityRequired) < 1) score = 0;
  if (urgent && score === 0) score = 1;
  const profile = order[score];
  return { profile, ...profiles[profile], constrained, urgent, score, requiredVerification: profiles[profile].verification };
}

export function profileAllowed(task, profile) {
  if (!task || !profile || !profiles[profile.profile]) return { allowed: false, reason: "execution profile is invalid" };
  const required = task.qualityRequired || "standard";
  const rank = (value) => value === "low" || value === "cheap" ? 0 : value === "high" || value === "thorough" ? 2 : 1;
  if (rank(profile.profile) < rank(required)) return { allowed: false, reason: "profile would undercut required verification" };
  return { allowed: true, reason: "profile meets required verification" };
}

// Records the model/effort outcome without claiming that a provider setting changed.
// A provider adapter may later turn a pending request into an applied change; until then
// the durable task record must distinguish intent from observed reality.
export function decideModelEffort({ requestedModel = null, requestedEffort = null, observedModel = null, observedEffort = null, control = "unavailable", provider = null, surface = null, now = new Date().toISOString() } = {}) {
  const requested = requestedModel || requestedEffort ? { model: requestedModel, effort: requestedEffort } : null;
  const observed = observedModel || observedEffort ? { model: observedModel, effort: observedEffort } : null;
  let status = "unknown";
  let reason = "no model or effort evidence was supplied";
  if (!requested && observed) { status = "observed"; reason = "provider or host reported the active model/effort"; }
  else if (requested && observed && requested.model === observed.model && (!requested.effort || requested.effort === observed.effort)) { status = "unchanged"; reason = "observed model/effort already matches the request"; }
  else if (requested && control === "supported") { status = "pending"; reason = "a provider control adapter is available but has not applied the request"; }
  else if (requested) { status = "unavailable"; reason = "the active surface does not expose approved model control"; }
  return { status, reason, provider, surface, requested, observed, effective: observed, control, decidedAt: now };
}

export function executionProfiles() { return Object.entries(profiles).map(([name, value]) => ({ name, ...value })); }
