#!/usr/bin/env node
import assert from "node:assert/strict";
import { createTask } from "../scripts/task-state.mjs";
import { estimateNextStep, predictiveDecision } from "../scripts/predictive-budget.mjs";
const observation = { window: { usedPercentage: 40 } };
const explicit = estimateNextStep({ task: { budgetPolicy: { expectedStepPercent: 8, reservePercent: 10 } }, observation });
assert.equal(explicit.known, true); assert.equal(explicit.estimatedStepPercent, 8); assert.equal(explicit.source, "task-policy"); assert.equal(explicit.fits, true);
const measured = estimateNextStep({ task: {}, observation, previousObservation: { window: { usedPercentage: 32 } } });
assert.equal(measured.estimatedStepPercent, 8); assert.equal(measured.source, "observed-delta");
const resetArgs = { task: { budgetPolicy: { requirePrediction: true } }, observation: { window: { usedPercentage: 10 } }, previousObservation: { window: { usedPercentage: 90 } } };
assert.equal(estimateNextStep(resetArgs).known, false); assert.equal(predictiveDecision(resetArgs).allowed, false);
const capped = predictiveDecision({ task: { budgetPolicy: { expectedStepPercent: 8, maxStepPercent: 5 } }, observation }); assert.equal(capped.allowed, false);
const reserveAligned = predictiveDecision({ task: { budgetPolicy: { expectedStepPercent: 8 } }, observation, reservePercent: 55 }); assert.equal(reserveAligned.allowed, false); assert.equal(reserveAligned.prediction.reservePercent, 55);
const task = createTask({ taskId: "predictive-task-001", idempotencyKey: "predictive-idem-001", budgetPolicy: { expectedStepPercent: 4, requirePrediction: true } }); assert.deepEqual(task.budgetPolicy, { expectedStepPercent: 4, requirePrediction: true });
console.log("predictive budget tests passed");
