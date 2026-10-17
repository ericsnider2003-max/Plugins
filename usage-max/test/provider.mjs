import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeClaudeLimits, normalizeCodexLimits, latestCodexCapture, latestCodexModel, fetchClaudeLimits, captureProviderLimits } from "../scripts/provider-limits.mjs";
import { readLedger } from "../scripts/observation-ledger.mjs";

const claude = normalizeClaudeLimits({ limits: [
  { kind: "session", percent: 12, resets_at: "2026-10-15T10:00:00Z" },
  { kind: "weekly_all", percent: 34, resets_at: "2026-10-18T18:00:00Z" },
  { kind: "weekly_scoped", percent: 3, resets_at: "2026-10-18T18:00:00Z", scope: { model: { display_name: "Fable" } } }
] }, Date.parse("2026-10-15T06:00:00Z"));
assert.deepEqual(Object.keys(claude.rate_limits), ["five_hour", "seven_day", "weekly_scoped"]);
assert.equal(claude.source, "claude-api");

const codex = normalizeCodexLimits({ rate_limits: { limit_id: "codex", primary: { used_percent: 76, window_minutes: 10080, resets_at: 1792035306 } } });
assert.equal(codex.rate_limits.codex_primary.used_percentage, 76);
assert.equal(normalizeCodexLimits({ accountId: "acct-1", rate_limits: { limit_id: "codex", primary: { used_percent: 1, window_minutes: 10080, resets_at: 1792035306 } } }).account, "acct-1");
assert.equal(codex.rate_limits.codex_primary.label, "WEEKLY");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "um-provider-"));
const rollout = path.join(home, ".codex", "sessions", "2026", "10");
fs.mkdirSync(rollout, { recursive: true });
fs.writeFileSync(path.join(rollout, "rollout.jsonl"), [
  { timestamp: "2026-10-15T05:59:00Z", payload: { model: "gpt-6.1-sol", reasoning_effort: "high" } },
  { timestamp: "2026-10-15T06:00:00Z", payload: { rate_limits: { limit_id: "codex", primary: { used_percent: 76, window_minutes: 10080, resets_at: 1792035306 } } } }
].map((x) => JSON.stringify(x)).join("\n") + "\n");
assert.equal(latestCodexCapture(path.join(home, ".codex")).rate_limits.codex_primary.used_percentage, 76);
assert.equal(latestCodexModel(path.join(home, ".codex")).model, "gpt-6.1-sol"); assert.equal(latestCodexModel(path.join(home, ".codex")).effort, "high");
const fallbackResult = await captureProviderLimits({ home, refreshClaude: false, codexLive: false, write: false, ingest: false }); assert.equal(fallbackResult.captureStatus.codex, "local-fallback"); assert.equal(fallbackResult.captureSources.codex, "local-fallback");

const staleHome = fs.mkdtempSync(path.join(os.tmpdir(), "um-stale-provider-"));
fs.mkdirSync(path.join(staleHome, ".usage-max"), { recursive: true });
fs.writeFileSync(path.join(staleHome, ".usage-max", "provider-limits.json"), JSON.stringify({ captures: {
  claude: { capturedAt: "2026-10-14T06:00:00Z", source: "claude-api", rate_limits: { five_hour: { used_percentage: 90, resets_at: 1792051200 } } }
} }));
const staleResult = await captureProviderLimits({ home: staleHome, refreshClaude: false, codexLive: false, write: true, ingest: true });
assert.match(staleResult.warnings.join("\n"), /Claude/);
assert.equal(staleResult.captureStatus.claude, "cached-stale"); assert.equal(staleResult.freshCaptures.claude, undefined);
assert.equal(readLedger(path.join(staleHome, ".usage-max", "observations.jsonl")).length, 0, "failed refresh must not ingest cached evidence");

const creds = path.join(home, ".claude");
fs.mkdirSync(creds, { recursive: true });
fs.writeFileSync(path.join(creds, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "never-written-to-cache" } }));
const got = await fetchClaudeLimits({ home, refresh: false, fetchImpl: async (url, opts) => {
  assert.match(url, /anthropic\.com\/api\/oauth\/usage/);
  assert.equal(opts.headers.Authorization, "Bearer never-written-to-cache");
  return { ok: true, status: 200, json: async () => ({ five_hour: { utilization: 1, resets_at: "2026-10-15T10:00:00Z" } }) };
} });
assert.equal(got.rate_limits.five_hour.used_percentage, 1);
assert.doesNotMatch(JSON.stringify(got), /never-written-to-cache/);
console.log("provider tests passed");
