#!/usr/bin/env node
import assert from "node:assert/strict";
import { rolloutDecision } from "../scripts/rollout.mjs";
assert.equal(rolloutDecision().mode, "observation-only");
assert.equal(rolloutDecision({ requested: "enforcement", approved: true }).allowed, false);
assert.equal(rolloutDecision({ requested: "enforcement", approved: true, killSwitch: true }).reason, "kill switch active");
const evidence = { modelIdentity: true, providerFreshness: true, taskProgress: true, completionEvidence: true, recoveryEvidence: true };
const blocked = rolloutDecision({ requested: "enforcement", approved: true, evidence }); assert.equal(blocked.reason, "trial is not ended");
const trial = { state: "ended", startedAt: "2026-10-14T08:00:00Z", endedAt: "2026-10-15T08:00:00Z", metrics: Object.keys(evidence).map((name) => ({ name, passed: true, recordedAt: "2026-10-15T07:00:00Z" })) };
const candidate = rolloutDecision({ requested: "enforcement", approved: true, evidence, trial });
assert.equal(candidate.mode, "enforcement-candidate"); assert.equal(candidate.allowed, false);
console.log("rollout safety gate tests passed");
