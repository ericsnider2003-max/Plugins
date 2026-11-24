// Ported from Umbrella Project skills/usage-max/queue-gate.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { planUsageRoute, verifyUsageOutcome } from './controller.mjs';
import { assertSafeIdentifier } from './identifiers.mjs';

const EVENT_SCHEMA = 1;

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function eventDirectory(root) {
  return path.join(root, 'operations', 'runs', 'usage-max', 'events');
}

function writeAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function admissionPath(root, workId, attemptId) {
  return path.join(eventDirectory(root), `${workId}--${attemptId}--admitted.json`);
}

function outcomePath(root, workId, attemptId) {
  return path.join(eventDirectory(root), `${workId}--${attemptId}--outcome.json`);
}

export class UsageAdmissionError extends Error {
  constructor(message, decision) {
    super(message);
    this.name = 'UsageAdmissionError';
    this.decision = decision;
  }
}

export function admitWorkUnit({ root, request }) {
  assert(typeof root === 'string' && root.length > 0, 'root is required');
  assert(request && typeof request === 'object', 'request is required');
  const workId = request.workId;
  const attemptId = request.attemptId;
  const leaseId = request.leaseId;
  assertSafeIdentifier(workId, 'workId');
  assertSafeIdentifier(attemptId, 'attemptId');
  assertSafeIdentifier(leaseId, 'leaseId');
  const plan = planUsageRoute(request.plan);
  if (plan.decision !== 'admit') throw new UsageAdmissionError(`usage admission rejected: ${plan.reason}`, plan);
  const filePath = admissionPath(root, workId, attemptId);
  fs.mkdirSync(eventDirectory(root), { recursive: true });
  if (fs.existsSync(filePath)) throw new UsageAdmissionError('duplicate admission attempt', { decision: 'duplicate', filePath });
  const record = {
    schemaVersion: EVENT_SCHEMA,
    event: 'usage-admitted',
    workId,
    attemptId,
    leaseId,
    createdAt: new Date().toISOString(),
    routeFingerprint: plan.routeFingerprint,
    plan,
    recordHash: null,
  };
  record.recordHash = hash({ ...record, recordHash: null });
  writeAtomic(filePath, record);
  return { filePath, record, plan };
}

export function verifyAdmission({ root, workId, attemptId, routeFingerprint }) {
  assertSafeIdentifier(workId, 'workId');
  assertSafeIdentifier(attemptId, 'attemptId');
  const filePath = admissionPath(root, workId, attemptId);
  assert(fs.existsSync(filePath), 'admission record is missing');
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const expectedHash = hash({ ...record, recordHash: null });
  assert(record.recordHash === expectedHash, 'admission record hash mismatch');
  assert(record.routeFingerprint === routeFingerprint, 'route fingerprint mismatch');
  return record;
}

export function recordUsageOutcome({ root, workId, attemptId, routeFingerprint, outcome }) {
  assertSafeIdentifier(workId, 'workId');
  assertSafeIdentifier(attemptId, 'attemptId');
  const admission = verifyAdmission({ root, workId, attemptId, routeFingerprint });
  const verification = verifyUsageOutcome(admission.plan, outcome);
  const filePath = outcomePath(root, workId, attemptId);
  const record = {
    schemaVersion: EVENT_SCHEMA,
    event: verification.pass ? 'usage-verified' : 'usage-escalated',
    workId,
    attemptId,
    routeFingerprint,
    admissionHash: admission.recordHash,
    outcome,
    verification,
    createdAt: new Date().toISOString(),
    recordHash: null,
  };
  record.recordHash = hash({ ...record, recordHash: null });
  writeAtomic(filePath, record);
  return { filePath, record, verification };
}
