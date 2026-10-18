// Deterministic task lifecycle primitives. Persistence and workers are separate later phases.
const transitions = {
  queued: new Set(["admitted", "paused_for_approval", "failed"]), admitted: new Set(["running", "paused_for_usage", "paused_for_approval", "failed"]),
  running: new Set(["checkpointing", "handoff_pending", "paused_for_usage", "paused_for_approval", "verifying", "failed"]), checkpointing: new Set(["running", "handoff_pending", "paused_for_usage", "paused_for_approval", "verifying", "failed"]),
  handoff_pending: new Set(["queued", "running", "paused_for_approval", "failed", "recovery_required"]), paused_for_usage: new Set(["queued", "admitted", "handoff_pending", "failed"]), paused_for_approval: new Set(["queued", "admitted", "failed"]),
  recovery_required: new Set(["queued", "failed"]),
  verifying: new Set(["completed", "failed", "dead_letter"]), completed: new Set(), failed: new Set(["queued", "dead_letter"]), dead_letter: new Set()
};
export function createTask({ taskId, idempotencyKey, now = new Date().toISOString(), checkpointPath = ".usage-max/checkpoints/pending.json", dependencies = [], retry = {}, priority = 0, qualityRequired = "standard", executionProfile = null, provider = null, surface = null, accountSlot = null, requestedModel = null, requestedEffort = null, deadlineAt = null, maxConcurrency = null, budgetPolicy = {}, assigned = false, authorization = {}, executionMode = "interactive", governance = null, unattendedPolicy = null }) {
  if (!taskId || !idempotencyKey) throw new Error("taskId and idempotencyKey are required");
  const repositoryActions = [...new Set(Array.isArray(authorization?.repositoryActions) ? authorization.repositoryActions.filter((x) => ["install", "commit"].includes(x)) : [])];
  const policy = budgetPolicy && typeof budgetPolicy === "object" ? budgetPolicy : {}; const budget = {};
  for (const key of ["expectedStepPercent", "maxStepPercent", "reservePercent"]) if (Number.isFinite(Number(policy[key])) && Number(policy[key]) >= 0 && Number(policy[key]) <= 100) budget[key] = Number(policy[key]);
  if (policy.requirePrediction === true) budget.requirePrediction = true;
  const mode = executionMode === "unattended" ? "unattended" : "interactive";
  const unattended = mode === "unattended" ? { maxSessions: 8, maxWallClockMs: 8 * 60 * 60 * 1000, maxRetries: 2, ...(unattendedPolicy || {}) } : null;
  const gov = governance || { required: true, policyRevision: "usage-max.portable.v1", status: "active", failClosed: true, reminderVersion: 1, lastRemindedAt: null };
  return { contract: "usage-max.task.v1", taskId, state: "queued", createdAt: now, updatedAt: now, attempt: 0, idempotencyKey, assigned: Boolean(assigned), executionMode: mode, governance: gov, unattendedPolicy: unattended, supervisor: null, authorization: { repositoryActions }, dependencies: [...dependencies], retry: { maxAttempts: Number(retry.maxAttempts) || 0, baseDelayMs: Number(retry.baseDelayMs) || 60000, maxDelayMs: Number(retry.maxDelayMs) || 3600000 }, priority: Number(priority) || 0, qualityRequired: ["low", "standard", "high"].includes(qualityRequired) ? qualityRequired : "standard", executionProfile, provider, surface, accountSlot, requestedModel, requestedEffort, deadlineAt, maxConcurrency: Number.isFinite(Number(maxConcurrency)) && Number(maxConcurrency) > 0 ? Number(maxConcurrency) : null, budgetPolicy: budget, modelDecision: null, verification: null, checkpoint: { version: 0, path: checkpointPath, digest: "pending0" }, effects: [], lease: null };
}
export function transitionTask(task, next, now = new Date().toISOString()) {
  if (!transitions[task.state]?.has(next)) throw new Error(`invalid task transition: ${task.state} -> ${next}`);
  return { ...task, state: next, updatedAt: now, attempt: next === "running" ? task.attempt + 1 : task.attempt };
}
export function acquireLease(task, owner, expiresAt, now = new Date().toISOString()) {
  if (!owner || !expiresAt) throw new Error("lease owner and expiry are required");
  const nowMs = Date.parse(now); const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiryMs) || expiryMs <= nowMs) throw new Error("lease expiry must be a future timestamp");
  if (task.lease && Date.parse(task.lease.expiresAt) > Date.parse(now)) throw new Error("task already has an active lease");
  return { ...task, lease: { owner, expiresAt }, updatedAt: now };
}
export function releaseLease(task, now = new Date().toISOString()) { return { ...task, lease: null, updatedAt: now }; }
export function recordEffect(task, effect, now = new Date().toISOString()) {
  if (!effect?.effectId || !effect.kind || !["planned", "started", "committed", "failed", "skipped"].includes(effect.state)) throw new Error("invalid effect record");
  const existing = task.effects.find((x) => x.effectId === effect.effectId);
  if (existing) { if (existing.state === "committed" && effect.state !== "committed") return task; return { ...task, effects: task.effects.map((x) => x.effectId === effect.effectId ? { ...x, ...effect } : x), updatedAt: now }; }
  return { ...task, effects: [...task.effects, effect], updatedAt: now };
}
export function canComplete(task) { return task.state === "verifying" && task.effects.every((x) => ["committed", "skipped"].includes(x.state)); }

export function markRecoveryRequired(task, reason = "process restarted with an in-flight task", now = new Date().toISOString()) {
  if (!task?.taskId) throw new Error("task identity is missing");
  if (!["running", "checkpointing", "handoff_pending", "admitted"].includes(task.state)) return task;
  return { ...task, state: "recovery_required", recovery: { reason, requiredAt: now, reconciled: false }, lease: null, updatedAt: now };
}
export function reconcileRecovery(task, { safeToRetry = false, now = new Date().toISOString() } = {}) {
  if (task?.state !== "recovery_required") throw new Error("task is not awaiting recovery");
  if (!safeToRetry) return { ...task, recovery: { ...task.recovery, reconciled: true, safeToRetry: false, reconciledAt: now }, updatedAt: now };
  return transitionTask({ ...task, recovery: { ...task.recovery, reconciled: true, safeToRetry: true, reconciledAt: now } }, "queued", now);
}
