#!/usr/bin/env node
import assert from "node:assert/strict";
import { analyzeReads, assessSubagentROI, estimateContext, recommendModelEffort } from "../scripts/usage-advisor.mjs";
const context = estimateContext({ conversationTokens: 1000, instructionTokens: 3000, selectedFiles: [{ path: "src/a.ts", tokens: 5000 }], toolSchemaTokens: 500, priorOutputTokens: 1000, modelWindowTokens: 12000 });
assert.equal(context.status, "near-window"); assert.ok(context.advice.includes("move reference material out of always-loaded instructions")); assert.equal(context.contributors.selectedFiles, 5000);
const explicit = recommendModelEffort({ complexity: "low", requestedModel: "user-selected-model", requestedEffort: "high" }); assert.equal(explicit.status, "preserve-explicit-request"); assert.equal(explicit.providerControl, "unavailable-unless-approved-adapter");
const roi = assessSubagentROI({ fanOut: 3, expectedOverlap: 0.75, expectedParallelBenefit: 10, descendantBudget: 2, verificationReserve: 5, perAgentTokens: 10 }); assert.equal(roi.status, "review"); assert.equal(roi.action, "observation-only; no subagent is started or stopped");
const reads = analyzeReads([{ path: "a.ts", hash: "a", bytes: 10 }, { path: "a.ts", hash: "a", bytes: 10 }, { path: "a.ts", hash: "a", bytes: 10 }, { path: "bundle.js", hash: "b", bytes: 200000 }]); assert.equal(reads.status, "review"); assert.equal(reads.repeatedUnchanged[0].path, "a.ts"); assert.equal(reads.oversizedInputs[0].path, "bundle.js");
console.log("usage advisor tests passed");
