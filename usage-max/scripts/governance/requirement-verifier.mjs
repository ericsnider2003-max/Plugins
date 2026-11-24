// Ported from Umbrella Project skills/usage-max/requirement-verifier.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import fs from 'node:fs';
import path from 'node:path';

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

import { verifyWorkContractOutcome } from './work-contract.mjs';

function verifyContractReceipt({ root, task, outcome }) {
  if (!task.workContract?.enforceOutcome) return { pass: true, reason: 'contract-receipt-not-required' };
  const receiptPath = outcome.artifact?.receiptPath;
  if (typeof root !== 'string' || root.length === 0) return { pass: false, reason: 'artifact-root-not-supplied' };
  if (typeof receiptPath !== 'string' || receiptPath.length === 0 || path.isAbsolute(receiptPath)) return { pass: false, reason: 'contract-receipt-path-required' };
  const absolute = path.resolve(root, receiptPath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(absolute)) return { pass: false, reason: 'contract-receipt-missing-or-outside-root' };
  let receipt;
  try { receipt = JSON.parse(fs.readFileSync(absolute, 'utf8')); } catch { return { pass: false, reason: 'contract-receipt-not-json' }; }
  const evidence = new Set(receipt.evidence ?? []);
  const missingEvidence = (task.requiredEvidence ?? []).filter((item) => !evidence.has(item));
  const pass = receipt.taskId === task.id && receipt.contractFingerprint === task.workContract.contractFingerprint && receipt.verified === true && missingEvidence.length === 0;
  return { pass, reason: pass ? 'contract-receipt-bound-and-present' : 'contract-receipt-identity-or-evidence-mismatch', missingEvidence };
}

export function verifyTaskArtifact(task, outcome, { root = null } = {}) {
  assert(task && typeof task === 'object', 'task is required');
  assert(outcome && typeof outcome === 'object', 'outcome is required');
  const requiredEvidence = [...new Set(task.requiredEvidence ?? outcome.requiredEvidence ?? [])];
  const requiredFields = [...new Set(task.requiredFields ?? [])];
  const requiredAcceptance = [...new Set(task.acceptance ?? [])];
  const evidence = new Set(outcome.evidence ?? []);
  const acceptance = new Set(outcome.acceptance ?? []);
  const missingEvidence = requiredEvidence.filter((item) => !evidence.has(item));
  const missingFields = requiredFields.filter((field) => outcome[field] === undefined && outcome.artifact?.[field] === undefined);
  const missingAcceptance = requiredAcceptance.filter((item) => !acceptance.has(item));
  const workContractVerification = task.workContract
    ? verifyWorkContractOutcome(task.workContract, outcome)
    : { pass: true, missingFields: [], decision: 'verified', reason: 'no-work-contract-attached' };
  const contractReceiptVerification = verifyContractReceipt({ root, task, outcome });
  const pass = outcome.taskId === task.id && missingEvidence.length === 0 && missingFields.length === 0 && missingAcceptance.length === 0 && workContractVerification.pass && contractReceiptVerification.pass;
  return { pass, taskId: task.id, missingEvidence, missingFields: [...missingFields, ...workContractVerification.missingFields], missingAcceptance, requiredEvidence, requiredFields, requiredAcceptance, workContractVerification, contractReceiptVerification, decision: pass ? 'verified' : 'escalate-or-reopen' };
}
