import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTask } from "./task-state.mjs";
import { loadTasks, saveTask } from "./task-store.mjs";
import { runTaskOnce } from "./worker-loop.mjs";
import { governanceStatus, markGovernanceReminder } from "./task-governance.mjs";
import { markRecoveryRequired } from "./task-state.mjs";
const recordFile = (home, taskId) => path.join(home, ".usage-max", "supervisors", `${taskId}.json`);
const stopFile = (home, task) => task.unattendedPolicy?.emergencyStopPath || path.join(home, ".usage-max", "stops", `${task.taskId}.stop`);
const lockFile = (home, taskId) => path.join(home, ".usage-max", "supervisors", `${taskId}.lock`);
function writeRecord(home, record) { const file = recordFile(home, record.taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }); }
function acquireSupervisorLock(home, taskId, owner) { const file = lockFile(home, taskId); fs.mkdirSync(path.dirname(file), { recursive: true }); try { const fd = fs.openSync(file, "wx"); fs.writeFileSync(fd, JSON.stringify({ owner, pid: process.pid, acquiredAt: new Date().toISOString() })); fs.closeSync(fd); return () => { try { fs.unlinkSync(file); } catch {} }; } catch (error) { if (error.code === "EEXIST") throw new Error(`supervisor is already running for ${taskId}`); throw error; } }
export async function runUnattendedTask({ home = os.homedir(), task = null, taskId, idempotencyKey, now = new Date().toISOString(), observation, observe = null, accountApproved, owner = "unattended-supervisor", maxSessions = null, maxWallClockMs = null, clock = null, worker, verify = null, reconcile = null, reservation = null, requiredEffectIds = [], tasks = null } = {}) {
  if (typeof worker !== "function") throw new Error("worker is required");
  const file = path.join(home, ".usage-max", "tasks.jsonl");
  let current = task || loadTasks(file).get(taskId) || createTask({ taskId, idempotencyKey, now, executionMode: "unattended" });
  if (current.executionMode !== "unattended") return { task: current, started: false, reason: "task is not authorized for unattended execution" };
  const gov = governanceStatus(current);
  if (!gov.available) { current = { ...current, governance: { ...(current.governance || {}), status: "unavailable" }, state: current.state === "queued" ? "paused_for_approval" : current.state, updatedAt: now }; saveTask(file, current); return { task: current, started: false, reason: gov.reason }; }
  const policy = current.unattendedPolicy || {}; const limit = Math.max(1, Number(maxSessions || policy.maxSessions || 1)); const wallClock = Number(maxWallClockMs || policy.maxWallClockMs || 0); const currentClock = typeof clock === "function" ? clock : () => Date.parse(now); const startedAt = currentClock();
  const release = acquireSupervisorLock(home, current.taskId, owner);
  const record = { taskId: current.taskId, launchId: current.supervisor?.launchId || null, sessionCount: current.supervisor?.sessionCount || 0, stopReason: null, startedAt: new Date(startedAt).toISOString(), updatedAt: now };
  try {
    for (let n = 0; n < limit; n++) {
      const sessionNow = new Date(currentClock()).toISOString();
      if (current.stop || fs.existsSync(stopFile(home, current))) { record.stopReason = "emergency stop requested"; current = { ...current, stop: { reason: record.stopReason, requestedAt: sessionNow }, supervisor: { ...record }, updatedAt: sessionNow }; saveTask(file, current); writeRecord(home, record); return { task: current, started: false, stopped: true, reason: record.stopReason }; }
      if (current.deadlineAt && Date.parse(current.deadlineAt) <= Date.parse(sessionNow)) { record.stopReason = "task deadline reached"; current = { ...current, state: "dead_letter", supervisor: { ...record, stopReason: record.stopReason }, updatedAt: sessionNow }; saveTask(file, current); writeRecord(home, record); return { task: current, started: false, reason: record.stopReason }; }
      if (wallClock > 0 && currentClock() - startedAt >= wallClock) { record.stopReason = "wall-clock limit reached"; current = { ...current, state: "dead_letter", supervisor: { ...record, stopReason: record.stopReason }, updatedAt: sessionNow }; saveTask(file, current); writeRecord(home, record); return { task: current, started: false, reason: record.stopReason }; }
      if (typeof reconcile === "function") { const check = await reconcile({ task: current, phase: "before-launch", sessionCount: record.sessionCount }); if (check?.safe === false) { record.stopReason = check.reason || "checkpoint/effect reconciliation required"; current = markRecoveryRequired(current, record.stopReason, sessionNow); saveTask(file, current); writeRecord(home, record); return { task: current, started: false, reason: record.stopReason }; } if (check?.task) current = check.task; }
      const fresh = typeof observe === "function" ? await observe({ task: current, sessionCount: record.sessionCount }) : null; const sessionObservation = fresh?.observation || observation; const sessionApproved = fresh?.accountApproved ?? accountApproved; if (!sessionObservation) { record.stopReason = "fresh provider observation unavailable"; current = { ...current, state: "paused_for_usage", supervisor: { ...record, stopReason: record.stopReason }, updatedAt: sessionNow }; saveTask(file, current); writeRecord(home, record); return { task: current, started: false, reason: record.stopReason }; }
      const launchId = `${current.taskId}:${current.checkpoint.digest}:${record.sessionCount + 1}`; record.launchId = launchId; record.sessionCount += 1; record.updatedAt = sessionNow; current = markGovernanceReminder({ ...current, supervisor: { ...record }, updatedAt: sessionNow }, sessionNow); saveTask(file, current); writeRecord(home, record);
      const result = await runTaskOnce({ task: current, taskId: current.taskId, idempotencyKey, observation: sessionObservation, accountApproved: sessionApproved, owner, now: sessionNow, reservation: typeof reservation === "function" ? await reservation({ task: current, observation: sessionObservation }) : reservation, tasks: tasks || loadTasks(file), execute: async (ctx) => { const out = await worker({ ...ctx, launchId, reminder: current.governance }); if (out?.structured === false) { const error = new Error(out.parseReason || "structured worker result is required"); error.retryable = false; throw error; } if (out?.outcome === "failed") { const error = new Error(out.error || "worker reported failure"); error.retryable = out.retryable !== false; throw error; } return { ...out, continue: out?.outcome === "continue" || out?.continue === true }; }, verify, requiredEffectIds });
      current = { ...result.task, supervisor: { ...record, lastOutcome: result.task.state === "running" ? "continue" : result.task.state, updatedAt: sessionNow }, updatedAt: sessionNow }; saveTask(file, current);
      if (current.state !== "running") return { ...result, task: current, sessions: record.sessionCount };
    }
    record.stopReason = "session limit reached"; current = { ...current, state: "dead_letter", supervisor: { ...record }, updatedAt: new Date(currentClock()).toISOString() }; saveTask(file, current); writeRecord(home, record); return { task: current, started: true, sessions: record.sessionCount, reason: record.stopReason };
  } finally { release(); }
}
