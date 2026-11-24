// Ported from Umbrella Project skills/usage-max/coordinator.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import { admitQueuedWorkUnit, checkpointWorkUnit, completeWorkUnit } from './durable-queue.mjs';

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

/**
 * The smallest executable Umbrella coordinator seam. It admits before worker
 * lookup/execution and records the outcome before returning control to a caller.
 * The executor registry is intentionally explicit: arbitrary command execution
 * is not a usage-control primitive.
 */
export async function dispatchWorkUnit({ root, request, executors }) {
  void root;
  void request;
  void executors;
  throw new TypeError('legacy dispatch bypass disabled; use dispatchQueuedWorkUnit or the canonical work-unit producer');
}

export async function dispatchQueuedWorkUnit({ root, workId, registry, executors }) {
  assert(registry && typeof registry === 'object', 'registry is required');
  assert(executors && typeof executors === 'object', 'executors is required');
  const admitted = admitQueuedWorkUnit({ root, workId, registry });
  const active = admitted.queue.activeAttempt;
  const route = admitted.admission.plan.selectedRoute;
  const executor = executors[route.executorKey ?? route.id];
  if (typeof executor !== 'function') return { decision: 'escalate-or-reopen', reason: 'registered-route-has-no-executor', queue: admitted.queue };
  checkpointWorkUnit({ root, workId, attemptId: active.attemptId, leaseId: active.leaseId, checkpoint: { phase: 'coordinator-dispatch' } });
  // The controller plan is intentionally normalized and does not carry the
  // full task payload. Real producers need the durable task contract (prompt,
  // source identity, required evidence, and required fields) to execute and
  // verify their work, so pass it explicitly without changing the plan hash.
  const executorPlan = { ...admitted.admission.plan, task: admitted.queue.task };
  let outcome;
  try {
    outcome = await executor({ workId, attemptId: active.attemptId, leaseId: active.leaseId, route, task: admitted.queue.task, plan: executorPlan });
  } catch (error) {
    // Convert executor/evaluator failure into a durable failed outcome so the
    // lease cannot strand the queue in `running`. Do not persist exception text:
    // provider errors can accidentally echo credentials or private prompts.
    outcome = { taskId: admitted.queue.task.id, qualityScore: 0, evidence: [], artifact: { failureKind: 'executor-exception' } };
  }
  const completed = completeWorkUnit({ root, workId, attemptId: active.attemptId, leaseId: active.leaseId, outcome });
  return { decision: completed.queue.state === 'verified' ? 'verified' : 'escalate-or-reopen', queue: completed.queue, outcome: completed.outcome };
}
