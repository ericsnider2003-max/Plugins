import assert from "node:assert/strict";
import { planWorkflow } from "../scripts/workflow-autopilot.mjs";
assert.deepEqual(planWorkflow({ prompt: "fix one typo", files: 1 }).stages, ["direct"]);
assert.deepEqual(planWorkflow({ prompt: "audit and refactor the entire system", files: 20 }).stages, ["scout", "worker", "verify", "review"]);
const constrained = planWorkflow({ prompt: "build a dashboard", files: 12, allowance: { state: "red", remainingPercent: 10 } });
assert.equal(constrained.interactiveNonBlocking, true);
assert.equal(constrained.constrained, true);
console.log("workflow autopilot tests passed");
