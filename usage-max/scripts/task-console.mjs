// Read-only task console projection plus an explicit emergency stop control.
import os from "node:os";
import path from "node:path";
import { loadTasks, saveTask } from "./task-store.mjs";
import { readLedger } from "./observation-ledger.mjs";
import { inspectHealth } from "./watchdog.mjs";
import { nextWake } from "./scheduler.mjs";
import { serviceState } from "./worker-service.mjs";

const data = (home) => path.join(home, ".usage-max");
const relevantFor = (ledger, task) => ledger.filter((x) => (task.surface ? x.surface === task.surface : task.provider ? x.provider === task.provider : true) && (task.accountSlot ? x.account?.slot === task.accountSlot : true));
const newest = (rows) => [...rows].sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0))[0] || null;

export function taskConsole(home = os.homedir(), { now = Date.now() } = {}) {
  const tasks = [...loadTasks(path.join(data(home), "tasks.jsonl")).values()]; const ledger = readLedger(path.join(data(home), "observations.jsonl"));
  const rows = tasks.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0) || Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0)).map((task) => {
    const relevant = relevantFor(ledger, task); const activityObservation = newest(relevant); const providerObservation = newest(relevant.filter((x) => x.authority === "provider")); const health = inspectHealth({ now, lastHeartbeatAt: task.updatedAt, lastMeaningfulAt: task.updatedAt }); const wake = nextWake({ observation: providerObservation, now });
    return { taskId: task.taskId, state: task.state, provider: task.provider || null, surface: task.surface || null, accountSlot: task.accountSlot || null, model: activityObservation?.model?.canonical || activityObservation?.model?.raw || null, modelKnown: activityObservation?.model?.known === true, modelSelection: activityObservation?.data?.modelSelection || null, modelDecision: task.modelDecision || null, deadlineAt: task.deadlineAt || null, maxConcurrency: task.maxConcurrency || null, quota: providerObservation?.window ? { id: providerObservation.window.id, kind: providerObservation.window.kind, usedPercentage: providerObservation.window.usedPercentage, resetsAt: providerObservation.window.resetsAt } : null, authority: providerObservation?.authority || null, freshness: providerObservation?.freshness || null, checkpoint: task.checkpoint || null, lease: task.lease || null, health, wake, attempt: task.attempt || 0, retryAt: task.retryAt || null, updatedAt: task.updatedAt || null };
  });
  return { generatedAt: new Date(now).toISOString(), mode: serviceState(home).mode || "observation-only", service: serviceState(home), stopAvailable: rows.some((x) => !["completed", "dead_letter"].includes(x.state)), tasks: rows };
}

export function stopAllTasks(home = os.homedir(), { now = new Date().toISOString(), reason = "emergency stop requested" } = {}) {
  const file = path.join(data(home), "tasks.jsonl"); const tasks = loadTasks(file); const stopped = [];
  for (const task of tasks.values()) {
    if (["completed", "dead_letter", "recovery_required", "paused_for_approval"].includes(task.state)) continue;
    saveTask(file, { ...task, state: "paused_for_approval", stop: { reason, requestedAt: now }, lease: null, updatedAt: now }); stopped.push(task.taskId);
  }
  return { stopped, count: stopped.length, reason };
}
