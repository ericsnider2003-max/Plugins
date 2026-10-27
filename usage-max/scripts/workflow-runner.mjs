import { runTaskOnce } from "./worker-loop.mjs";
import { createTask } from "./task-state.mjs";
import { appendWorkflow, readWorkflows } from "./workflow-ledger.mjs";
import fs from "node:fs";
import path from "node:path";

// Explicit unattended runner. Interactive tasks are refused before any worker
// or side effect is invoked. Each stage must return a checkpoint and an
// explicit outcome; effects are deduplicated by task-state.recordEffect.
export async function runWorkflow({ home, task = null, taskId, idempotencyKey, stages = [], observation, accountApproved = false, worker, verify = null, now = new Date().toISOString() } = {}) {
  if (!home || !taskId || !idempotencyKey || !Array.isArray(stages) || !stages.length) throw new Error("home, task identity, and stages are required");
  const taskFile = path.join(home, ".usage-max", "workflow-tasks", `${taskId}.json`);
  let current = task || (() => { try { return JSON.parse(fs.readFileSync(taskFile, "utf8")); } catch { return createTask({ taskId, idempotencyKey, now, executionMode: "unattended" }); } })();
  if (current.executionMode !== "unattended") return { started: false, reason: "workflow runner requires explicit unattended execution", task: current };
  const results = [];
  const completedStages = new Set(readWorkflows(home).filter((x) => x.workflowId === current.taskId && ["completed", "verifying"].includes(x.state)).map((x) => x.stageId));
  for (const stage of stages) {
    const stageId = typeof stage === "string" ? stage : stage.id;
    if (!stageId) throw new Error("workflow stage id is required");
    if (completedStages.has(stageId)) { results.push({ stageId, state: "completed", started: false, resumed: true, checkpoint: current.checkpoint }); continue; }
    const result = await runTaskOnce({ task: current, taskId: current.taskId, idempotencyKey: current.idempotencyKey, observation, accountApproved, now, verify: stageId === stages.at(-1) ? verify : null, execute: async (ctx) => worker({ ...ctx, stageId, stage }) });
    current = result.task; results.push({ stageId, state: current.state, started: result.started, decision: result.decision, error: result.error || null, checkpoint: current.checkpoint });
    fs.mkdirSync(path.dirname(taskFile), { recursive: true }); fs.writeFileSync(taskFile, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
    appendWorkflow(home, { eventId: `${current.taskId}:${stageId}:${current.checkpoint?.digest || "pending"}`, workflowId: current.taskId, stageId, state: current.state, checkpoint: current.checkpoint, error: result.error || null, usage: result.usage || null, verification: result.verification || null, capturedAt: now });
    if (!result.started || result.error || ["failed", "paused_for_usage", "paused_for_approval", "dead_letter", "recovery_required"].includes(current.state)) return { started: results.some((x) => x.started), completed: false, task: current, results, reason: result.error || result.decision?.reason || current.state };
  }
  return { started: results.some((x) => x.started), completed: current.state === "completed", task: current, results, reason: current.state };
}
