// Ported from Umbrella Project skills/usage-max/durable-queue.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { planUsageRoute } from './controller.mjs';
import { admitWorkUnit, recordUsageOutcome } from './queue-gate.mjs';
import { routesForTask, verifyRouteEvidence } from './route-registry.mjs';
import { verifyTaskArtifact } from './requirement-verifier.mjs';
import { assertSafeIdentifier } from './identifiers.mjs';

const QUEUE_SCHEMA = 1;

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function queueDirectory(root) {
  return path.join(root, 'operations', 'runs', 'usage-max', 'queue');
}

function queuePath(root, workId) {
  return path.join(queueDirectory(root), `${workId}.json`);
}

function withQueueLock(root, workId, operation) {
  const directory = queueDirectory(root);
  const lockPath = path.join(directory, `${workId}.lock`);
  fs.mkdirSync(directory, { recursive: true });
  let descriptor = null;
  let reclaimed = false;
  try {
    while (descriptor === null) {
      try {
        descriptor = fs.openSync(lockPath, 'wx');
      } catch (error) {
        if (error.code !== 'EEXIST' || reclaimed) throw new Error(`queue is locked: ${workId}`);
        let owner = null;
        try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { throw new Error(`queue is locked: ${workId}`); }
        if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error(`queue is locked: ${workId}`);
        try { process.kill(owner.pid, 0); throw new Error(`queue is locked: ${workId}`); }
        catch (probeError) {
          if (probeError.message === `queue is locked: ${workId}` || probeError.code === 'EPERM') throw new Error(`queue is locked: ${workId}`);
          fs.unlinkSync(lockPath);
          reclaimed = true;
        }
      }
    }
    fs.writeSync(descriptor, JSON.stringify({ workId, pid: process.pid, acquiredAt: new Date().toISOString() }));
    return operation();
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    if (descriptor !== null) {
      try { fs.unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

function writeAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function seal(record) {
  return { ...record, recordHash: hash({ ...record, recordHash: null }) };
}

function saveQueueRecord(root, record) {
  fs.mkdirSync(queueDirectory(root), { recursive: true });
  writeAtomic(queuePath(root, record.workId), seal({ ...record, recordHash: null }));
}

function readQueueRecord(root, workId) {
  const filePath = queuePath(root, workId);
  assert(fs.existsSync(filePath), `queue record is missing: ${workId}`);
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert(record.recordHash === hash({ ...record, recordHash: null }), `queue record hash mismatch: ${workId}`);
  return record;
}

function assertAttempt(record, attemptId, leaseId) {
  assert(record.activeAttempt?.attemptId === attemptId, 'stale attempt is fenced');
  assert(record.activeAttempt?.leaseId === leaseId, 'stale lease is fenced');
}

export function enqueueWorkUnit({ root, request }) {
  assert(typeof root === 'string' && root.length > 0, 'root is required');
  assert(request && typeof request === 'object', 'request is required');
  assertSafeIdentifier(request.workId, 'request.workId');
  assert(request.task && typeof request.task.id === 'string', 'request.task.id is required');
  assert(request.task.id === request.workId, 'task identity must equal workId');
  return withQueueLock(root, request.workId, () => {
    assert(!fs.existsSync(queuePath(root, request.workId)), `duplicate queued work unit: ${request.workId}`);
    const record = {
      schemaVersion: QUEUE_SCHEMA,
      event: 'work-queued',
      workId: request.workId,
      createdAt: new Date().toISOString(),
      state: 'queued',
      mode: request.mode ?? 'interactive',
      task: { ...request.task },
      observation: { ...(request.observation ?? {}) },
      recoveryReserve: request.recoveryReserve ?? { requiredUnits: 0, availableUnits: null },
      attempts: [],
      checkpoints: [],
      activeAttempt: null,
      lastResult: null,
      recordHash: null,
    };
    saveQueueRecord(root, record);
    return { filePath: queuePath(root, request.workId), record: readQueueRecord(root, request.workId) };
  });
}

export function readQueuedWorkUnit({ root, workId }) {
  assertSafeIdentifier(workId, 'workId');
  return readQueueRecord(root, workId);
}

export function admitQueuedWorkUnit({ root, workId, registry }) {
  return withQueueLock(root, workId, () => {
    const current = readQueueRecord(root, workId);
    assert(!current.registryFingerprint || current.registryFingerprint === registry.fingerprint, 'route registry drift is not permitted for an existing work unit');
    assert(['queued', 'retryable'].includes(current.state), `work unit is not admissible from state ${current.state}`);
    const evidence = verifyRouteEvidence(registry, root);
    assert(!current.registryEvidenceFingerprint || current.registryEvidenceFingerprint === evidence.evidenceFingerprint, 'route evidence drift is not permitted for an existing work unit');
    const task = { ...current.task, excludedRouteIds: current.task.excludedRouteIds ?? [] };
    const routes = routesForTask(registry, task).map((route) => ({ ...route, evidenceDigest: evidence.evidenceDigests[route.id] }));
    const planInput = { mode: current.mode, task, observation: current.observation, routes, recoveryReserve: current.recoveryReserve };
    const plan = planUsageRoute(planInput);
    const attemptId = `attempt-${current.attempts.length + 1}-${crypto.randomUUID()}`;
    const leaseId = `lease-${crypto.randomUUID()}`;
    const admitted = admitWorkUnit({ root, request: { workId, attemptId, leaseId, plan: planInput } });
    const next = {
      ...current,
      event: 'work-admitted',
      state: 'admitted',
      registryId: registry.registryId,
      registryFingerprint: registry.fingerprint,
      registryEvidenceFingerprint: evidence.evidenceFingerprint,
      activeAttempt: { attemptId, leaseId, routeId: plan.selectedRoute.id, routeFingerprint: plan.routeFingerprint, admittedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
      attempts: [...current.attempts, { attemptId, leaseId, routeId: plan.selectedRoute.id, routeFingerprint: plan.routeFingerprint, state: 'active' }],
    };
    saveQueueRecord(root, next);
    return { queue: readQueueRecord(root, workId), admission: admitted };
  });
}

export function checkpointWorkUnit({ root, workId, attemptId, leaseId, checkpoint }) {
  assert(checkpoint && typeof checkpoint === 'object', 'checkpoint is required');
  return withQueueLock(root, workId, () => {
    const current = readQueueRecord(root, workId);
    assertAttempt(current, attemptId, leaseId);
    assert(['admitted', 'running'].includes(current.state), `work unit is not checkpointable from state ${current.state}`);
    const sequence = current.checkpoints.length + 1;
    const next = { ...current, event: 'work-checkpointed', state: 'running', checkpoints: [...current.checkpoints, { sequence, attemptId, leaseId, capturedAt: new Date().toISOString(), ...checkpoint }] };
    saveQueueRecord(root, next);
    return readQueueRecord(root, workId);
  });
}

export function completeWorkUnit({ root, workId, attemptId, leaseId, outcome }) {
  return withQueueLock(root, workId, () => {
    const current = readQueueRecord(root, workId);
    assertAttempt(current, attemptId, leaseId);
    assert(['admitted', 'running'].includes(current.state), `work unit is not completable from state ${current.state}`);
    const active = current.activeAttempt;
    const artifactVerification = verifyTaskArtifact(current.task, outcome, { root });
    const verifiedOutcome = { ...outcome, requiredEvidence: current.task.requiredEvidence ?? outcome.requiredEvidence ?? [], artifactVerification };
    const recorded = recordUsageOutcome({ root, workId, attemptId, routeFingerprint: active.routeFingerprint, outcome: verifiedOutcome });
    const finalState = recorded.verification.pass ? 'verified' : 'retryable';
    const attempts = current.attempts.map((attempt) => attempt.attemptId === attemptId ? { ...attempt, state: finalState, completedAt: new Date().toISOString(), verification: recorded.verification } : attempt);
    const next = { ...current, event: recorded.record.event === 'usage-verified' ? 'work-verified' : 'work-retryable', state: finalState, activeAttempt: null, attempts, lastResult: { attemptId, routeId: active.routeId, verification: recorded.verification } };
    saveQueueRecord(root, next);
    return { queue: readQueueRecord(root, workId), outcome: recorded };
  });
}

export function prepareRetryWorkUnit({ root, workId, failedRouteId }) {
  return withQueueLock(root, workId, () => {
    const current = readQueueRecord(root, workId);
    assert(current.state === 'retryable', `work unit is not retryable from state ${current.state}`);
    const excluded = [...new Set([...(current.task.excludedRouteIds ?? []), failedRouteId])];
    const next = { ...current, event: 'work-retry-prepared', state: 'queued', task: { ...current.task, excludedRouteIds: excluded }, lastResult: { ...current.lastResult, retryPrepared: true, failedRouteId } };
    saveQueueRecord(root, next);
    return readQueueRecord(root, workId);
  });
}

export function verifyQueueRecord({ root, workId }) {
  const record = readQueueRecord(root, workId);
  assert(record.schemaVersion === QUEUE_SCHEMA, 'unsupported queue schema');
  let previous = 0;
  for (const checkpoint of record.checkpoints) {
    assert(checkpoint.sequence === previous + 1, 'checkpoint sequence is not monotonic');
    previous = checkpoint.sequence;
  }
  if (record.state === 'verified') assert(record.activeAttempt === null, 'verified work retains active lease');
  return { pass: true, workId, state: record.state, attempts: record.attempts.length, checkpoints: record.checkpoints.length, registryId: record.registryId ?? null };
}

export function recoverAbandonedWorkUnit({ root, workId, now = new Date().toISOString() }) {
  return withQueueLock(root, workId, () => {
    const current = readQueueRecord(root, workId);
    if (!current.activeAttempt || !current.activeAttempt.expiresAt || Date.parse(current.activeAttempt.expiresAt) > Date.parse(now)) return { recovered: false, queue: current };
    const attemptId = current.activeAttempt.attemptId;
    const next = {
      ...current,
      event: 'work-abandoned',
      state: 'retryable',
      activeAttempt: null,
      attempts: current.attempts.map((attempt) => attempt.attemptId === attemptId ? { ...attempt, state: 'abandoned', abandonedAt: now } : attempt),
      lastResult: { attemptId, recovery: 'lease-expired' },
    };
    saveQueueRecord(root, next);
    return { recovered: true, queue: readQueueRecord(root, workId) };
  });
}
