// Ported from Umbrella Project skills/usage-max/verify-receipts.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeIdentifier } from './identifiers.mjs';

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function verifyUsageReceipts(root, workId, attemptId) {
  assertSafeIdentifier(workId, 'workId');
  assertSafeIdentifier(attemptId, 'attemptId');
  const directory = path.join(root, 'operations', 'runs', 'usage-max', 'events');
  const admittedPath = path.join(directory, `${workId}--${attemptId}--admitted.json`);
  const outcomePath = path.join(directory, `${workId}--${attemptId}--outcome.json`);
  const admitted = JSON.parse(fs.readFileSync(admittedPath, 'utf8'));
  const outcome = JSON.parse(fs.readFileSync(outcomePath, 'utf8'));
  if (admitted.recordHash !== hash({ ...admitted, recordHash: null })) throw new Error('admission hash mismatch');
  if (outcome.recordHash !== hash({ ...outcome, recordHash: null })) throw new Error('outcome hash mismatch');
  if (admitted.event !== 'usage-admitted' || admitted.plan.decision !== 'admit') throw new Error('invalid admission event');
  if (outcome.admissionHash !== admitted.recordHash) throw new Error('admission linkage mismatch');
  if (outcome.routeFingerprint !== admitted.routeFingerprint) throw new Error('route linkage mismatch');
  const raw = outcome.outcome ?? {};
  const requiredEvidence = raw.requiredEvidence ?? [];
  const missingEvidence = requiredEvidence.filter((item) => !raw.evidence?.includes(item));
  const recomputedPass = raw.taskId === admitted.plan.taskId && Number.isFinite(raw.qualityScore) && raw.qualityScore >= admitted.plan.qualityThreshold && missingEvidence.length === 0 && raw.artifactVerification?.pass !== false;
  if (outcome.event !== (recomputedPass ? 'usage-verified' : 'usage-escalated')) throw new Error('outcome event does not match recomputed decision');
  if (outcome.verification.pass !== recomputedPass) throw new Error('stored verification does not match recomputed decision');
  if (!recomputedPass) throw new Error('outcome is not verified');
  return { pass: true, workId, attemptId, eventCount: 2, routeFingerprint: admitted.routeFingerprint };
}

if (process.argv[1]?.endsWith('verify-receipts.mjs')) {
  try {
    const result = verifyUsageReceipts(process.argv[2], process.argv[3], process.argv[4]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
