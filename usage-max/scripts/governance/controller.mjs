// Ported from Umbrella Project skills/usage-max/controller.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ALLOWANCE_STATES = new Set(['fresh', 'stale', 'unknown', 'refused']);
const MODES = new Set(['interactive', 'batch', 'ci', 'evaluation']);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function numberInRange(value, name, min = 0, max = 1) {
  assert(Number.isFinite(value) && value >= min && value <= max, `${name} must be between ${min} and ${max}`);
  return value;
}

function normalizeObservation(observation = {}) {
  const state = observation.state ?? 'unknown';
  assert(ALLOWANCE_STATES.has(state), `unsupported allowance state: ${state}`);
  const normalized = {
    state,
    authority: observation.authority ?? 'none',
    capturedAt: observation.capturedAt ?? null,
    source: observation.source ?? 'unavailable',
  };
  if (state === 'fresh') {
    const captured = Date.parse(observation.capturedAt ?? '');
    const now = Date.parse(observation.now ?? new Date().toISOString());
    const maxAgeMs = observation.maxAgeMs ?? 15 * 60 * 1000;
    const freshAuthority = observation.authority === 'provider';
    const freshTimestamp = Number.isFinite(captured) && Number.isFinite(now) && now >= captured && now - captured <= maxAgeMs;
    if (!freshAuthority || !freshTimestamp) {
      normalized.state = Number.isFinite(captured) && Number.isFinite(now) && now - captured > maxAgeMs ? 'stale' : 'unknown';
      normalized.freshnessIssue = !freshAuthority ? 'provider-authority-required' : 'fresh-observation-missing-or-expired';
    }
  }
  if (observation.remainingFraction !== undefined) {
    normalized.remainingFraction = numberInRange(observation.remainingFraction, 'remainingFraction');
  }
  return normalized;
}

function normalizeRoute(route, qualityThreshold, requiredCapabilities) {
  assert(route && typeof route.id === 'string' && route.id.length > 0, 'route.id is required');
  assert(Number.isFinite(route.estimatedUnits) && route.estimatedUnits >= 0, `${route.id}: estimatedUnits must be non-negative`);
  const capabilities = new Set(route.capabilities ?? []);
  const missing = requiredCapabilities.filter((capability) => !capabilities.has(capability));
  const qualityFloor = numberInRange(route.qualityFloor ?? 0, `${route.id}.qualityFloor`);
  return {
    id: route.id,
    kind: route.kind ?? 'model',
    tier: route.tier ?? 'unknown',
    estimatedUnits: route.estimatedUnits,
    qualityFloor,
    capabilities: [...capabilities].sort(),
    available: route.available !== false,
    missingCapabilities: missing,
    eligible: route.available !== false && missing.length === 0 && qualityFloor >= qualityThreshold,
  };
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function planUsageRoute(input) {
  assert(input && typeof input === 'object', 'input is required');
  const mode = input.mode ?? 'interactive';
  assert(MODES.has(mode), `unsupported mode: ${mode}`);
  const task = input.task ?? {};
  assert(typeof task.id === 'string' && task.id.length > 0, 'task.id is required');
  const qualityThreshold = numberInRange(task.qualityThreshold ?? 0.8, 'task.qualityThreshold');
  const requiredCapabilities = [...new Set(task.requiredCapabilities ?? [])].sort();
  const observation = normalizeObservation(input.observation);
  const recoveryReserve = input.recoveryReserve ?? { requiredUnits: 0, availableUnits: null };
  assert(Number.isFinite(recoveryReserve.requiredUnits) && recoveryReserve.requiredUnits >= 0, 'recoveryReserve.requiredUnits must be non-negative');
  assert(recoveryReserve.availableUnits === null || (Number.isFinite(recoveryReserve.availableUnits) && recoveryReserve.availableUnits >= 0), 'recoveryReserve.availableUnits must be non-negative or null');
  const routes = (input.routes ?? []).map((route) => normalizeRoute(route, qualityThreshold, requiredCapabilities));
  const ordered = routes.filter((route) => route.eligible).sort((left, right) => left.estimatedUnits - right.estimatedUnits || left.id.localeCompare(right.id));
  const reserveInsufficient = recoveryReserve.availableUnits !== null && recoveryReserve.availableUnits < recoveryReserve.requiredUnits;
  const batchTelemetryInsufficient = mode !== 'interactive' && observation.state !== 'fresh';
  const batchGateHold = mode !== 'interactive' && (batchTelemetryInsufficient || reserveInsufficient);
  const base = {
    controller: 'umbrella-usage-max',
    schemaVersion: 1,
    taskId: task.id,
    mode,
    qualityThreshold,
    requiredCapabilities,
    allowance: observation,
    recoveryReserve,
    routeCandidates: routes,
    routeFingerprint: fingerprint({ mode, task, observation, recoveryReserve, routes }),
    checkpointRequired: true,
    batchGate: mode === 'interactive' ? 'not-applicable' : (batchGateHold ? 'hold' : 'pass'),
  };
  if (batchGateHold) {
    return { ...base, decision: 'hold', selectedRoute: null, bounded: true, reason: batchTelemetryInsufficient ? 'batch-requires-fresh-provider-observation' : 'recovery-reserve-insufficient', nextAction: batchTelemetryInsufficient ? 'refresh-provider-observation-or-run-as-interactive-bounded-unit' : 'restore-recovery-reserve' };
  }
  const selectedRoute = ordered[0] ?? null;
  if (!selectedRoute) {
    return { ...base, decision: mode === 'interactive' ? 'needs-capability' : 'hold', selectedRoute: null, bounded: true, reason: 'no-available-route-meets-quality-and-capability-floor', nextAction: 'add-capable-route-or-raise-owner-decision' };
  }
  return { ...base, decision: 'admit', selectedRoute, bounded: mode === 'interactive' && observation.state !== 'fresh', reason: mode === 'interactive' && observation.state !== 'fresh' ? 'interactive-unknown-or-stale-usage-bounded' : 'cheapest-sufficient-route', nextAction: 'checkpoint-then-verify-outcome' };
}

export function verifyUsageOutcome(plan, outcome) {
  assert(plan && typeof plan === 'object', 'plan is required');
  assert(outcome && typeof outcome === 'object', 'outcome is required');
  const qualityScore = numberInRange(outcome.qualityScore, 'outcome.qualityScore');
  const requiredEvidence = outcome.requiredEvidence ?? [];
  const missingEvidence = requiredEvidence.filter((item) => !outcome.evidence?.includes(item));
  const qualityPass = qualityScore >= plan.qualityThreshold;
  const evidencePass = missingEvidence.length === 0;
  const artifactPass = outcome.artifactVerification?.pass !== false;
  const pass = qualityPass && evidencePass && artifactPass && outcome.taskId === plan.taskId;
  return { pass, taskId: plan.taskId, routeId: plan.selectedRoute?.id ?? null, qualityScore, qualityPass, evidencePass, artifactPass, missingEvidence, decision: pass ? 'verified' : 'escalate-or-reopen', reason: pass ? 'quality-and-evidence-floor-met' : (!qualityPass ? 'quality-floor-not-met' : (!artifactPass ? 'task-artifact-requirement-failed' : (outcome.taskId !== plan.taskId ? 'task-identity-mismatch' : 'required-evidence-missing'))) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    try { process.stdout.write(`${JSON.stringify(planUsageRoute(JSON.parse(raw)), null, 2)}\n`); }
    catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
  });
}
