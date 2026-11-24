// Ported from Umbrella Project skills/capability-routing/work-contract.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import crypto from 'node:crypto';

const GENERIC_OBJECTIVES = new Set([
  'continue',
  'keep going',
  'work',
  'do it',
  'handle it',
  'research',
  'review',
  'check',
  'fix it',
]);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nonEmpty(value, name) {
  assert(typeof value === 'string' && value.trim().length > 0, `${name} must be a non-empty string`);
  return value.trim();
}

function list(value, name) {
  assert(Array.isArray(value), `${name} must be an array`);
  const normalized = [...new Set(value.map((item) => nonEmpty(String(item), `${name} item`)))];
  assert(normalized.length > 0, `${name} must not be empty`);
  return normalized;
}

function inferredObjective(task, capability) {
  const direct = task.objective ?? task.description ?? task.prompt ?? task.title;
  if (typeof direct === 'string' && direct.trim().length > 0 && !GENERIC_OBJECTIVES.has(direct.trim().toLowerCase())) return direct.trim();
  const label = capability?.name ?? capability?.id ?? 'selected capability';
  return `Complete one bounded ${label} work unit for task ${task.id}`;
}

/**
 * Compile the smallest useful execution contract. This is deliberately short:
 * it prevents no-op/status-only work without forcing a large planning packet.
 */
export function compileWorkContract({ task, capability = null }) {
  assert(task && typeof task === 'object', 'task is required');
  nonEmpty(task.id, 'task.id');
  const objective = inferredObjective(task, capability);
  const writeScopes = list((Array.isArray(task.writeScopes) && task.writeScopes.length > 0) ? task.writeScopes : (capability?.writeScopes?.length ? capability.writeScopes : ['task-output']), 'writeScopes');
  const acceptance = list((Array.isArray(task.acceptance) && task.acceptance.length > 0) ? task.acceptance : (capability?.acceptance?.length ? capability.acceptance : ['The bounded work unit is verified against its declared quality floor.']), 'acceptance');
  const requiredEvidence = list((Array.isArray(task.requiredEvidence) && task.requiredEvidence.length > 0) ? task.requiredEvidence : (capability?.requiredEvidence?.length ? capability.requiredEvidence : ['work-receipt']), 'requiredEvidence');
  const contract = {
    schemaVersion: 1,
    taskId: task.id,
    objective,
    scope: { writeScopes, maxSteps: 1 },
    acceptance,
    requiredEvidence,
    nextAction: nonEmpty(task.nextAction ?? 'execute-one-bounded-unit-and-verify', 'nextAction'),
    stopPredicate: nonEmpty(task.stopPredicate ?? 'stop-after-one-unit-or-owner-gate', 'stopPredicate'),
    contextPolicy: {
      mode: 'minimum-relevant-authority',
      maxSourceItems: Number.isInteger(task.contextBudget?.maxSourceItems) ? task.contextBudget.maxSourceItems : 8,
      preserveRawEvidence: true,
    },
    enforceOutcome: task.enforceWorkContract === true,
    requiredOutcomeFields: task.enforceWorkContract === true
      ? ['workPerformed', 'resultSummary', 'nextAction']
      : [],
  };
  assert(contract.contextPolicy.maxSourceItems > 0 && contract.contextPolicy.maxSourceItems <= 32, 'contextBudget.maxSourceItems must be between 1 and 32');
  return Object.freeze({ ...contract, contractFingerprint: hash(contract) });
}

export function verifyWorkContractOutcome(contract, outcome) {
  assert(contract && typeof contract === 'object', 'contract is required');
  assert(outcome && typeof outcome === 'object', 'outcome is required');
  const missingFields = [];
  if (contract.enforceOutcome) {
    if (outcome.workPerformed !== true) missingFields.push('workPerformed');
    if (typeof outcome.resultSummary !== 'string' || outcome.resultSummary.trim().length === 0) missingFields.push('resultSummary');
    if (typeof outcome.nextAction !== 'string' || outcome.nextAction.trim().length === 0) missingFields.push('nextAction');
  }
  const pass = missingFields.length === 0;
  return { pass, missingFields, decision: pass ? 'verified' : 'escalate-or-reopen', reason: pass ? 'bounded-work-contract-satisfied' : 'status-only-or-incomplete-work-result' };
}
