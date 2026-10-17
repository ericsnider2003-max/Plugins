import os from "node:os";
import path from "node:path";
import { runTaskOnce } from "./worker-loop.mjs";
import { loadTasks, saveTask } from "./task-store.mjs";

export async function runManagedTask({ home = os.homedir(), task = null, taskId, idempotencyKey, observation, accountApproved, owner = "worker", now = new Date().toISOString(), execute, verify, requiredEffectIds = [], reservation, previousObservation = null, observationHistory = [] } = {}) {
  const file = path.join(home, ".usage-max", "tasks.jsonl"); const existing = task || loadTasks(file).get(taskId) || null;
  const result = await runTaskOnce({ task: existing, taskId, idempotencyKey, observation, accountApproved, owner, now, execute, verify, requiredEffectIds, reservation, previousObservation, observationHistory, tasks: loadTasks(file) });
  if (result.started || !existing) saveTask(file, result.task);
  return { ...result, taskFile: file };
}
