#!/usr/bin/env node
// Stage 0: dependency-free contract and fixture checks. No network, credentials, or live provider calls.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const iso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const oneOf = (v, values) => values.includes(v);

function validateObservation(o) {
  assert.equal(o.contract, "usage-max.observation.v1");
  assert.ok(o.observationId && o.observationId.length >= 8);
  assert.ok(oneOf(o.provider, ["anthropic", "openai", "unknown"]));
  assert.ok(oneOf(o.surface, ["claude-code", "claude-desktop", "cowork", "chatgpt", "chatgpt-desktop", "codex-desktop", "codex-cli", "codex-cloud", "browser", "mobile", "unknown"]));
  assert.ok(o.source);
  assert.ok(iso(o.capturedAt));
  assert.ok(oneOf(o.authority, ["provider", "local-activity", "estimate", "unattributed"]));
  assert.ok(oneOf(o.state, ["governing", "observing", "unavailable", "quarantined"]));
  assert.ok(oneOf(o.freshness, ["fresh", "stale", "unknown"]));
  assert.ok(oneOf(o.confidence, ["measured", "derived", "estimated", "unknown"]));
  assert.equal(typeof o.data, "object");
  if (o.providerEventAt !== null && o.providerEventAt !== undefined) assert.ok(iso(o.providerEventAt));
  if (o.account) { assert.ok(o.account.slot); assert.equal(typeof o.account.approved, "boolean"); }
  if (o.window?.usedPercentage !== null && o.window?.usedPercentage !== undefined) assert.ok(o.window.usedPercentage >= 0 && o.window.usedPercentage <= 100);
  if (o.model) { assert.equal(typeof o.model.known, "boolean"); if (!o.model.known) assert.equal(o.model.canonical, null); }
}

function validateTask(t) {
  assert.equal(t.contract, "usage-max.task.v1");
  assert.ok(t.taskId && t.taskId.length >= 8);
  assert.ok(oneOf(t.state, ["queued", "admitted", "running", "checkpointing", "handoff_pending", "recovery_required", "paused_for_usage", "paused_for_approval", "verifying", "completed", "failed", "dead_letter"]));
  assert.ok(iso(t.createdAt) && iso(t.updatedAt));
  assert.ok(Number.isInteger(t.attempt) && t.attempt >= 0);
  assert.ok(t.idempotencyKey && t.idempotencyKey.length >= 8);
  assert.ok(Number.isInteger(t.checkpoint.version) && t.checkpoint.version >= 0);
  assert.ok(t.checkpoint.path && t.checkpoint.digest);
  assert.ok(Array.isArray(t.effects));
  for (const e of t.effects) assert.ok(e.effectId && oneOf(e.state, ["planned", "started", "committed", "failed", "skipped"]));
}

const observationSchema = read("contracts/observation.schema.json");
const taskSchema = read("contracts/task.schema.json");
const reservationSchema = read("contracts/reservation.schema.json");
const activitySchema = read("contracts/account-activity.schema.json");
const collectorSchema = read("contracts/collector-event.schema.json");
assert.equal(observationSchema.$id, "usage-max/observation/v1");
assert.equal(taskSchema.$id, "usage-max/task/v1");
assert.equal(reservationSchema.$id, "usage-max/reservation/v1");
assert.equal(activitySchema.$id, "usage-max/account-activity/v1");
assert.equal(collectorSchema.$id, "usage-max/collector-event/v1");

const fixtureDir = path.join(root, "test", "fixtures", "contracts");
const observations = fs.readdirSync(fixtureDir).filter((f) => f.startsWith("observation-")).sort();
assert.ok(observations.length >= 8, "fixture set must cover provider, local, unknown, replay, and unavailable observations");
for (const file of observations) validateObservation(read(path.join("test", "fixtures", "contracts", file)));
validateTask(read(path.join("test", "fixtures", "contracts", "task-paused.json")));

const replay = read(path.join("test", "fixtures", "contracts", "observation-replay.json"));
assert.equal(replay.state, "quarantined");
assert.equal(replay.authority, "provider");
const unavailable = read(path.join("test", "fixtures", "contracts", "observation-chatgpt-unavailable.json"));
assert.equal(unavailable.state, "unavailable");
assert.equal(unavailable.authority, "unattributed");
console.log(`contract tests passed (${observations.length} observation fixtures + 1 task fixture)`);
