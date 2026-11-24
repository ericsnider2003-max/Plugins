// Ported from Umbrella Project skills/usage-max/live-observation.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeCodexAppLimits } from './provider-observation.mjs';

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_CACHE = path.join(os.homedir(), '.usage-max', 'provider-limits.json');

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`provider snapshot cannot be read: ${filePath}: ${error.message}`);
  }
}

/**
 * Read the standalone Usage-max provider capture and convert it into the
 * narrow observation contract consumed by Umbrella's local controller.
 *
 * The cache is accepted only when the standalone adapter marked the Codex
 * capture both fresh and provider-live. The approved account slot remains an
 * explicit caller input; this adapter never infers approval from a UUID or
 * from the existence of a cache file.
 */
export function readLiveCodexObservation({
  cachePath = process.env.USAGE_MAX_PROVIDER_CACHE || DEFAULT_CACHE,
  accountSlot,
  accountsPath = path.join(os.homedir(), '.usage-max', 'accounts.json'),
  now = new Date().toISOString(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  accountSlot ||= process.env.USAGE_MAX_ACCOUNT_SLOT || resolveApprovedCodexSlot({ accountsPath });
  assert(typeof accountSlot === 'string' && accountSlot.length > 0, 'approved accountSlot is required');
  const snapshot = readJson(cachePath);
  const capture = snapshot.freshCaptures?.codex;
  assert(capture && typeof capture === 'object', 'fresh Codex provider capture is missing');
  assert(snapshot.captureStatus?.codex === 'fresh', 'Codex provider capture is not marked fresh');
  assert(snapshot.captureSources?.codex === 'provider-live', 'Codex capture is not provider-live');
  assert(capture.source === 'codex-app-server', 'Codex capture source is not the app-server adapter');

  const limit = capture.rate_limits?.codex_primary;
  assert(limit && typeof limit === 'object', 'Codex primary rate-limit window is missing');
  const raw = {
    ordinaryUsageAllowed: true,
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        primary: {
          usedPercent: limit.used_percentage,
          windowDurationMins: limit.window_minutes,
          resetsAt: limit.resets_at,
        },
      },
    },
  };
  const observation = normalizeCodexAppLimits(raw, {
    accountSlot,
    capturedAt: capture.capturedAt,
    now,
    maxAgeMs,
  });
  return {
    ...observation,
    source: 'usage-max-standalone-provider-cache',
    providerCaptureSource: capture.source,
    model: capture.model ? { canonical: capture.model, known: true, effort: capture.effort || null } : { canonical: null, known: false, effort: null },
  };
}

export function resolveApprovedCodexSlot({ accountsPath = path.join(os.homedir(), '.usage-max', 'accounts.json'), surface = 'codex-cli' } = {}) {
  const registry = readJson(accountsPath);
  const candidates = (registry.accounts || []).filter((account) => account.provider === 'openai' && account.approved === true && account.enabled === true && account.routingEnabled !== false && account.surfaces?.includes(surface));
  assert(candidates.length === 1, `expected exactly one approved OpenAI account for ${surface}; found ${candidates.length}`);
  return candidates[0].slot;
}

