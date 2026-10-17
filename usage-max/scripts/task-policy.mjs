export function dependencyDecision(task, tasks = new Map()) {
  const dependencies = Array.isArray(task?.dependencies) ? task.dependencies : [];
  const missing = dependencies.filter((id) => tasks.get(id)?.state !== "completed");
  return { allowed: missing.length === 0, missing, reason: missing.length ? "task dependencies are not completed" : "all dependencies completed" };
}
export function retryDecision(task, { now = Date.now() } = {}) {
  const policy = task?.retry || {}; const maxAttempts = Number(policy.maxAttempts) || 0; const attempt = Number(task?.attempt) || 0;
  if (task?.state === "failed" && task.retryAt && Date.parse(task.retryAt) > now) return { allowed: false, reason: "retry backoff is active", retryAt: task.retryAt };
  if (attempt >= maxAttempts) return { allowed: false, reason: "retry budget exhausted", attempt, maxAttempts };
  return { allowed: true, reason: "retry budget available", attempt, maxAttempts };
}
export function retryDelay(task, { jitterMs = 0 } = {}) { const policy = task?.retry || {}; const base = Math.max(1000, Number(policy.baseDelayMs) || 60000); const max = Math.max(base, Number(policy.maxDelayMs) || 3600000); return Math.min(max, base * (2 ** Math.max(0, Number(task?.attempt) || 0)) + Math.max(0, Number(jitterMs) || 0)); }
