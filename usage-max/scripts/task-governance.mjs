// Durable Usage-max governance is the authority; provider reminders are only a safety net.
export const POLICY_REVISION = "usage-max.portable.v1";
export function governanceStatus(task) {
  const g = task?.governance;
  if (!g || g.required !== true || g.failClosed !== true || !g.policyRevision || g.status !== "active") return { available: false, reason: "task-scoped Usage-max governance is missing or unavailable" };
  return { available: true, policyRevision: g.policyRevision };
}
export function governanceReminder(task, event = "turn") {
  const status = governanceStatus(task);
  if (!status.available) return `usage-max governance=unavailable task=${task?.taskId || "unknown"}; fail closed and pause for review.`;
  return `usage-max governance=active task=${task.taskId} policy=${status.policyRevision} event=${event}; use the durable checkpoint, obey budget/approval/stop limits, and do not treat a bounded session exit as completion.`;
}
export function markGovernanceReminder(task, now = new Date().toISOString()) {
  if (!governanceStatus(task).available) return { ...task, governance: { ...(task.governance || {}), status: "unavailable", lastRemindedAt: now }, updatedAt: now };
  return { ...task, governance: { ...task.governance, lastRemindedAt: now }, updatedAt: now };
}
