// Ported from Umbrella Project skills/usage-max/route-registry.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PROFILE_STATUSES = new Set(['fixture', 'measured']);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeRoute(route) {
  assert(route && typeof route === 'object', 'route is required');
  assert(typeof route.id === 'string' && route.id.length > 0, 'route.id is required');
  assert(Number.isFinite(route.estimatedUnits) && route.estimatedUnits >= 0, `${route.id}: estimatedUnits must be non-negative`);
  assert(Number.isFinite(route.qualityFloor) && route.qualityFloor >= 0 && route.qualityFloor <= 1, `${route.id}: qualityFloor must be between 0 and 1`);
  assert(PROFILE_STATUSES.has(route.profileStatus), `${route.id}: profileStatus must be fixture or measured`);
  assert(typeof route.evidencePath === 'string' && route.evidencePath.length > 0, `${route.id}: evidencePath is required`);
  const capabilities = [...new Set(route.capabilities ?? [])].sort();
  return {
    id: route.id,
    kind: route.kind ?? 'model',
    tier: route.tier ?? 'unknown',
    estimatedUnits: route.estimatedUnits,
    qualityFloor: route.qualityFloor,
    capabilities,
    available: route.available !== false,
    profileStatus: route.profileStatus,
    evidencePath: route.evidencePath,
    executorKey: route.executorKey ?? route.id,
  };
}

export function createRouteRegistry(routes) {
  assert(Array.isArray(routes) && routes.length > 0, 'at least one route profile is required');
  const normalized = routes.map(normalizeRoute);
  const ids = new Set();
  for (const route of normalized) {
    assert(!ids.has(route.id), `duplicate route id: ${route.id}`);
    ids.add(route.id);
  }
  const registry = {
    schemaVersion: 1,
    registryId: `route-registry-${hash(normalized).slice(0, 16)}`,
    routes: normalized,
  };
  registry.fingerprint = hash(registry);
  return Object.freeze(registry);
}

export function routesForTask(registry, task) {
  assert(registry && Array.isArray(registry.routes), 'registry is required');
  assert(task && typeof task === 'object', 'task is required');
  const required = new Set(task.requiredCapabilities ?? []);
  const excluded = new Set(task.excludedRouteIds ?? []);
  return registry.routes.filter((route) => route.available && !excluded.has(route.id) && [...required].every((capability) => route.capabilities.includes(capability)));
}

export function verifyRouteEvidence(registry, root) {
  assert(typeof root === 'string' && root.length > 0, 'root is required for route evidence verification');
  const evidenceDigests = {};
  for (const route of registry.routes) {
    const evidencePath = path.resolve(root, route.evidencePath);
    const relative = path.relative(root, evidencePath);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${route.id}: evidencePath escapes root`);
    assert(fs.existsSync(evidencePath), `${route.id}: evidence file is missing`);
    const raw = fs.readFileSync(evidencePath, 'utf8');
    const evidence = JSON.parse(raw);
    assert(evidence.routeId === route.id, `${route.id}: evidence route identity mismatch`);
    assert(evidence.profileStatus === route.profileStatus, `${route.id}: evidence profile status mismatch`);
    assert(JSON.stringify(evidence.capabilities ?? []) === JSON.stringify(route.capabilities), `${route.id}: evidence capabilities mismatch`);
    assert(evidence.qualityFloor === route.qualityFloor, `${route.id}: evidence quality floor mismatch`);
    assert(evidence.estimatedUnits === route.estimatedUnits, `${route.id}: evidence estimated units mismatch`);
    if (route.profileStatus === 'measured') {
      assert(typeof evidence.measurementId === 'string' && evidence.measurementId.length > 0, `${route.id}: measured evidence ID is required`);
      assert(Number.isFinite(evidence.observedMinQuality) && evidence.observedMinQuality >= route.qualityFloor, `${route.id}: measured quality floor is not met`);
    }
    evidenceDigests[route.id] = hash(raw);
  }
  return { pass: true, registryId: registry.registryId, routeCount: registry.routes.length, evidenceDigests, evidenceFingerprint: hash(evidenceDigests) };
}

export function getRouteProfile(registry, routeId) {
  const route = registry?.routes?.find((candidate) => candidate.id === routeId);
  assert(route, `route is not registered: ${routeId}`);
  return route;
}
