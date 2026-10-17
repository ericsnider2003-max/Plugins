#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendObservation, observationFingerprint, readLedger } from "../scripts/observation-ledger.mjs";
import { accountCanRun, accountHomeFingerprint, loadAccounts, registerAccount, resolveAccount, setAccountApproval, setAccountRouting, setAllAccountRouting } from "../scripts/accounts.mjs";

const d = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-ledger-"));
const ledger = path.join(d, "observations.jsonl");
const base = { contract: "usage-max.observation.v1", observationId: "obs-ledger-001", provider: "openai", surface: "codex-cli", source: "fixture", account: { slot: "openai-primary", approved: true }, capturedAt: "2026-10-15T06:00:00Z", providerEventAt: "2026-10-15T06:00:00Z", authority: "provider", state: "observing", freshness: "fresh", confidence: "measured", window: { id: "weekly-1", kind: "weekly", resetsAt: "2026-10-19T00:00:00Z", usedPercentage: 40 }, model: null, data: {} };
assert.equal(observationFingerprint(base), observationFingerprint({ ...base, observationId: "different-id" }));
assert.equal(appendObservation(ledger, base).added, true);
assert.equal(appendObservation(ledger, { ...base, observationId: "different-id" }).duplicate, true);
const replay = appendObservation(ledger, { ...base, observationId: "obs-ledger-002", capturedAt: "2026-10-15T07:00:00Z", providerEventAt: "2026-10-15T05:00:00Z", window: { ...base.window, usedPercentage: 30 } });
assert.equal(replay.observation.state, "quarantined");
const backward = appendObservation(ledger, { ...base, observationId: "obs-ledger-003", capturedAt: "2026-10-15T07:01:00Z", providerEventAt: "2026-10-15T07:01:00Z", window: { ...base.window, resetsAt: "2026-10-18T00:00:00Z", usedPercentage: 41 } });
assert.equal(backward.observation.state, "quarantined");
const local = appendObservation(ledger, { ...base, observationId: "obs-ledger-local", authority: "local-activity", source: "local-fixture", window: { ...base.window, usedPercentage: 1 }, data: { usedPercentage: 1 } });
assert.equal(local.observation.state, "observing", "local activity must not be quarantined by provider quota monotonicity");
assert.equal(readLedger(ledger).length, 4);

const accounts = path.join(d, "accounts.json");
const registered = registerAccount(accounts, { slot: "openai-primary", provider: "openai", surfaces: ["codex-cli", "codex-desktop"], home: "C:\\Users\\example\\.codex" });
assert.equal(registered.approved, false);
assert.equal(registered.homeFingerprint, accountHomeFingerprint("c:/users/example/.codex"));
assert.equal(accountCanRun(accounts, "openai-primary", "openai", "codex-cli"), false);
setAccountApproval(accounts, "openai-primary", { approved: true, approvedAt: "2026-10-15T07:00:00Z" });
assert.equal(accountCanRun(accounts, "openai-primary", "openai", "codex-cli"), true);
assert.equal(accountCanRun(accounts, "openai-primary", "openai", "chatgpt"), false);
assert.equal(loadAccounts(accounts).accounts[0].home, undefined);
assert.equal(resolveAccount(loadAccounts(accounts), { provider: "openai", surface: "codex-cli", home: "C:/Users/example/.codex" }).slot, "openai-primary");
setAccountRouting(accounts, "openai-primary", { enabled: false, reason: "test stop" }); assert.equal(accountCanRun(accounts, "openai-primary", "openai", "codex-cli"), false);
setAllAccountRouting(accounts, { enabled: false, reason: "emergency" }); assert.equal(loadAccounts(accounts).accounts[0].routingEnabled, false);
console.log("ledger and account tests passed");
