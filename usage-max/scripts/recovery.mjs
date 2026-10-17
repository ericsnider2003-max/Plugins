import { loadTasks, saveTask } from "./task-store.mjs";
import { markRecoveryRequired } from "./task-state.mjs";

export function recoverTasks(file, { now = new Date().toISOString(), owner = null } = {}) {
  const recovered = [];
  for (const task of loadTasks(file).values()) {
    if (!["running", "checkpointing", "handoff_pending", "admitted"].includes(task.state)) continue;
    // A persisted credential-free handoff with no active lease is already a
    // safe checkpoint boundary. Keep it launchable; only in-flight work needs
    // restart quarantine.
    if (task.state === "handoff_pending" && task.handoff?.handoffId && !task.lease) continue;
    // A successful external worker launch is a durable boundary owned by the
    // destination worker. Do not turn a service restart scan into a duplicate
    // launch or erase the destination binding.
    if (task.state === "running" && task.launch?.state === "started" && !task.lease) continue;
    if (owner && task.lease?.owner !== owner) continue;
    if (task.lease && Date.parse(task.lease.expiresAt) > Date.parse(now)) continue;
    const next = markRecoveryRequired(task, "expired lease or restart detected before effect reconciliation", now);
    saveTask(file, next); recovered.push(next);
  }
  return recovered;
}
