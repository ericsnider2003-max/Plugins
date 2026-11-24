// Ported from Umbrella Project skills/usage-max/parallel-dispatch.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeIdentifier } from './identifiers.mjs';
import { compileWorkContract } from './work-contract.mjs';

const DEFAULT_MAX_PARALLEL = 3;

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeSkill(skill) {
  assert(skill && typeof skill === 'object', 'skill is required');
  assertSafeIdentifier(skill.id, 'skill.id');
  const dependencies = uniqueSorted(skill.dependencies ?? []);
  const writeScopes = uniqueSorted(skill.writeScopes ?? []);
  const tags = uniqueSorted(skill.tags ?? []);
  const requiredCapabilities = uniqueSorted(skill.requiredCapabilities ?? []);
  const requiredEvidence = uniqueSorted(skill.requiredEvidence ?? []);
  const acceptance = uniqueSorted(skill.acceptance ?? []);
  const estimatedUnits = skill.estimatedUnits ?? 0;
  assert(Number.isFinite(estimatedUnits) && estimatedUnits >= 0, `${skill.id}: estimatedUnits must be non-negative`);
  const qualityThreshold = skill.qualityThreshold ?? null;
  if (qualityThreshold !== null) assert(Number.isFinite(qualityThreshold) && qualityThreshold >= 0 && qualityThreshold <= 1, `${skill.id}: qualityThreshold must be between 0 and 1`);
  for (const dependency of dependencies) assertSafeIdentifier(dependency, `${skill.id}.dependency`);
  return Object.freeze({
    id: skill.id,
    dependencies,
    writeScopes,
    tags,
    requiredCapabilities,
    requiredEvidence,
    acceptance,
    estimatedUnits,
    qualityThreshold,
    executorKey: skill.executorKey ?? null,
  });
}

function scopesOverlap(left, right) {
  return left.writeScopes.some((scope) => right.writeScopes.includes(scope));
}

function childWorkId(parentId, skillId) {
  const raw = `${parentId}--skill--${skillId}`;
  if (raw.length <= 128) return raw;
  return `${parentId.slice(0, 48)}--skill--${skillId.slice(0, 48)}--${hash(raw).slice(0, 16)}`;
}

function addDependencies(skillId, byId, selected, visiting) {
  if (selected.has(skillId)) return;
  if (visiting.has(skillId)) throw new TypeError(`skill dependency cycle includes ${skillId}`);
  const skill = byId.get(skillId);
  assert(skill, `skill is not registered: ${skillId}`);
  visiting.add(skillId);
  for (const dependency of skill.dependencies) addDependencies(dependency, byId, selected, visiting);
  visiting.delete(skillId);
  selected.add(skillId);
}

function buildWaves(selected, byId, maxParallel) {
  const remaining = new Set(selected);
  const completed = new Set();
  const waves = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .map((id) => byId.get(id))
      .filter((skill) => skill.dependencies.every((dependency) => completed.has(dependency)))
      .sort((left, right) => left.id.localeCompare(right.id));
    assert(ready.length > 0, 'skill dependency graph cannot be scheduled');
    const wave = [];
    for (const skill of ready) {
      if (wave.length >= maxParallel) break;
      if (wave.some((candidate) => scopesOverlap(candidate, skill))) continue;
      wave.push(skill);
    }
    assert(wave.length > 0, 'skill wave cannot be scheduled');
    waves.push(wave.map((skill) => skill.id));
    for (const skill of wave) {
      remaining.delete(skill.id);
      completed.add(skill.id);
    }
  }
  return waves;
}

/**
 * Selects task-requested skills into dependency-safe, non-overlapping waves.
 * This is planning only; each child still needs normal Usage-max admission.
 */
export function planParallelSkills({ task, skills, maxParallel = DEFAULT_MAX_PARALLEL, maxEstimatedUnits = null }) {
  assert(task && typeof task === 'object', 'task is required');
  assertSafeIdentifier(task.id, 'task.id');
  assert(Array.isArray(skills) && skills.length > 0, 'skills are required');
  assert(Number.isInteger(maxParallel) && maxParallel > 0 && maxParallel <= 32, 'maxParallel must be an integer from 1 to 32');
  assert(maxEstimatedUnits === null || (Number.isFinite(maxEstimatedUnits) && maxEstimatedUnits >= 0), 'maxEstimatedUnits must be non-negative or null');

  const normalized = skills.map(normalizeSkill);
  const byId = new Map();
  for (const skill of normalized) {
    assert(!byId.has(skill.id), `duplicate skill id: ${skill.id}`);
    byId.set(skill.id, skill);
  }
  const requested = task.skillIds ?? null;
  const requestedTags = uniqueSorted(task.requiredSkillTags ?? []);
  assert(requested !== null || requestedTags.length > 0, 'task.skillIds or task.requiredSkillTags must select at least one skill');
  const selectedByTags = requested === null
    ? normalized.filter((skill) => requestedTags.some((tag) => skill.tags.includes(tag))).map((skill) => skill.id)
    : requested;
  assert(Array.isArray(selectedByTags) && selectedByTags.length > 0, 'task selection matched no registered skills');
  const requestedIds = selectedByTags.map((id) => assertSafeIdentifier(id, 'task.skillId'));
  assert(new Set(requestedIds).size === requestedIds.length, 'task.skillIds contains a duplicate skill');
  const selected = new Set();
  for (const skillId of requestedIds) addDependencies(skillId, byId, selected, new Set());
  const selectedSkills = [...selected].map((id) => byId.get(id)).sort((left, right) => left.id.localeCompare(right.id));
  const waves = buildWaves(selected, byId, maxParallel);
  const estimatedUnits = selectedSkills.reduce((total, skill) => total + skill.estimatedUnits, 0);
  const planBase = {
    schemaVersion: 1,
    taskId: task.id,
    requestedSkillIds: requestedIds,
    selectedSkillIds: selectedSkills.map((skill) => skill.id),
    implicitDependencyIds: selectedSkills.filter((skill) => !requestedIds.includes(skill.id)).map((skill) => skill.id),
    waves,
    maxParallel,
    estimatedUnits,
    maxEstimatedUnits,
    routePolicy: 'each-child-must-pass-usage-max-admission-and-outcome-verification',
  };
  const planFingerprint = hash(planBase);
  if (maxEstimatedUnits !== null && estimatedUnits > maxEstimatedUnits) {
    return Object.freeze({ ...planBase, planFingerprint, decision: 'hold', reason: 'parallel-skill-budget-exceeded', nextAction: 'reduce-scope-or-run-as-smaller-bounded-unit' });
  }
  return Object.freeze({
    ...planBase,
    planFingerprint,
    decision: waves.some((wave) => wave.length > 1) ? 'parallel' : 'serial',
    reason: waves.some((wave) => wave.length > 1) ? 'independent-skills-grouped-into-bounded-waves' : 'dependencies-or-write-scopes-require-serial-waves',
    nextAction: 'admit-each-child-through-usage-max-before-execution',
  });
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function receiptPath(root, plan) {
  return path.join(root, 'operations', 'runs', 'usage-max', 'parallel', `${plan.taskId}--${plan.planFingerprint.slice(0, 16)}.json`);
}

function sealedReceipt(receipt) {
  return { ...receipt, recordHash: hash({ ...receipt, recordHash: null }) };
}

function childRequest(task, skill, plan) {
  const workId = childWorkId(task.id, skill.id);
  const childAcceptance = uniqueSorted([...(task.acceptance ?? []), ...skill.acceptance]);
  const childEvidence = uniqueSorted([...(task.requiredEvidence ?? []), ...skill.requiredEvidence]);
  const request = {
    workId,
    mode: task.mode ?? 'interactive',
    recoveryReserve: task.recoveryReserve ?? { requiredUnits: 0, availableUnits: null },
    task: {
      id: workId,
      parentTaskId: task.id,
      skillId: skill.id,
      requiredCapabilities: uniqueSorted([...(task.requiredCapabilities ?? []), ...skill.requiredCapabilities]),
      requiredEvidence: childEvidence,
      acceptance: childAcceptance,
      requiredFields: uniqueSorted(task.requiredFields ?? []),
      workContract: task.enforceWorkContract === true
        ? compileWorkContract({ task: { ...task, id: workId, writeScopes: skill.writeScopes, requiredEvidence: childEvidence, acceptance: childAcceptance } })
        : null,
      enforceWorkContract: task.enforceWorkContract === true,
      qualityThreshold: Math.max(task.qualityThreshold ?? 0.8, skill.qualityThreshold ?? 0),
      writeScopes: skill.writeScopes,
      planFingerprint: plan.planFingerprint,
    },
  };
  if (task.observation !== undefined) request.observation = task.observation;
  return request;
}

function childVerificationDecision(result, contractEnforced = false) {
  const dispatched = result?.dispatched ?? result;
  if (dispatched?.decision !== 'verified') return dispatched?.decision ?? 'unknown';
  if (contractEnforced) {
    const outcomeRecord = dispatched?.outcome?.record?.outcome ?? dispatched?.outcome?.outcome ?? dispatched?.outcome;
    if (outcomeRecord?.artifactVerification?.workContractVerification?.pass !== true || outcomeRecord?.artifactVerification?.contractReceiptVerification?.pass !== true) return 'unverified-contract-proof';
  }
  const durableProof = dispatched?.queue?.state === 'verified' &&
    (dispatched?.outcome?.artifactVerification?.pass === true ||
      dispatched?.queue?.lastResult?.verification?.artifactPass === true);
  const explicitProof = dispatched?.verification?.pass === true;
  return durableProof || explicitProof ? 'verified' : 'unverified-callback';
}

/**
 * Executes waves with bounded parallelism. A failed child prevents dependent
 * waves from running, and every child is admitted and verified independently.
 */
export async function dispatchParallelSkillWork({ root, task, skills, submitAndDispatch, maxParallel = DEFAULT_MAX_PARALLEL, maxEstimatedUnits = null }) {
  assert(typeof root === 'string' && root.length > 0, 'root is required');
  assert(typeof submitAndDispatch === 'function', 'submitAndDispatch is required');
  const plan = planParallelSkills({ task, skills, maxParallel, maxEstimatedUnits });
  if (plan.decision === 'hold') {
    const receipt = sealedReceipt({
      schemaVersion: 1,
      event: 'parallel-skill-dispatch',
      createdAt: new Date().toISOString(),
      plan,
      results: [],
      decision: 'hold',
      reason: plan.reason,
      recordHash: null,
    });
    const outputPath = receiptPath(root, plan);
    writeAtomic(outputPath, receipt);
    return { decision: 'hold', plan, results: [], receiptPath: outputPath };
  }
  const byId = new Map(skills.map(normalizeSkill).map((skill) => [skill.id, skill]));
  const results = [];
  let failedWave = false;
  for (const wave of plan.waves) {
    if (failedWave) {
      for (const skillId of wave) results.push({ skillId, decision: 'skipped', reason: 'prior-wave-failed' });
      continue;
    }
    const settled = await Promise.allSettled(wave.map((skillId) => {
      const skill = byId.get(skillId);
      return submitAndDispatch(childRequest(task, skill, plan)).then((result) => ({ skillId, decision: childVerificationDecision(result, task.enforceWorkContract === true), result }));
    }));
    for (let index = 0; index < settled.length; index += 1) {
      const item = settled[index];
      if (item.status === 'fulfilled') results.push(item.value);
      else results.push({ skillId: wave[index], decision: 'rejected', reason: 'admission-or-executor-failure' });
    }
    failedWave = settled.some((item) => item.status !== 'fulfilled' || !['verified'].includes(item.value.decision));
  }
  const verified = !failedWave && results.length === plan.selectedSkillIds.length && results.every((result) => result.decision === 'verified');
  const receipt = sealedReceipt({
    schemaVersion: 1,
    event: 'parallel-skill-dispatch',
    createdAt: new Date().toISOString(),
    plan,
    results: results.map(({ skillId, decision, reason }) => ({ skillId, decision, ...(reason ? { reason } : {}) })),
    decision: verified ? 'verified' : 'escalate-or-reopen',
    recordHash: null,
  });
  const outputPath = receiptPath(root, plan);
  writeAtomic(outputPath, receipt);
  return { decision: receipt.decision, plan, results: receipt.results, receiptPath: outputPath };
}

export function verifyParallelReceipt({ root, taskId, receiptFile }) {
  assert(typeof root === 'string' && root.length > 0, 'root is required');
  assertSafeIdentifier(taskId, 'taskId');
  assert(typeof receiptFile === 'string' && receiptFile.length > 0, 'receiptFile is required');
  const absolute = path.resolve(root, receiptFile);
  const relative = path.relative(root, absolute);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'receiptFile escapes root');
  const receipt = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  assert(receipt.plan?.taskId === taskId, 'parallel receipt task identity mismatch');
  assert(receipt.recordHash === hash({ ...receipt, recordHash: null }), 'parallel receipt hash mismatch');
  const expectedResultCount = receipt.plan.decision === 'hold' ? 0 : receipt.plan.selectedSkillIds.length;
  assert(receipt.results.length === expectedResultCount, 'parallel receipt result count mismatch');
  const expectedIds = receipt.plan.decision === 'hold' ? [] : [...receipt.plan.selectedSkillIds].sort();
  const actualIds = [...receipt.results].map((result) => result.skillId).sort();
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), 'parallel receipt skill identity mismatch');
  const allVerified = receipt.results.every((result) => result.decision === 'verified');
  const expectedDecision = receipt.plan.decision === 'hold'
    ? 'hold'
    : (allVerified ? 'verified' : 'escalate-or-reopen');
  assert(receipt.decision === expectedDecision, 'parallel receipt final decision is inconsistent with child decisions');
  if (receipt.decision === 'verified') assert(allVerified, 'verified parallel receipt contains a non-verified child');
  if (receipt.decision === 'hold') assert(receipt.results.length === 0 && receipt.plan.decision === 'hold', 'held parallel receipt contains executed children');
  return { pass: true, taskId, decision: receipt.decision, resultCount: receipt.results.length, receiptFile: absolute };
}
