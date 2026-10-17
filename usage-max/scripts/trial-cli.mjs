#!/usr/bin/env node
import os from "node:os";
import { currentTrials, endTrial, evaluateTrial, readTrials, recordTrialMetric, startTrial, trialPreflight } from "./trial.mjs";
const [op = "status", ...args] = process.argv.slice(2); const home = process.env.USAGE_MAX_HOME || os.homedir();
if (op === "status") { const trials = currentTrials(home).map((trial) => ({ ...trial, metrics: undefined, metricCount: Array.isArray(trial.metrics) ? trial.metrics.length : 0, gate: evaluateTrial(trial) })); console.log(JSON.stringify(trials, null, 2)); process.exit(0); }
if (op === "raw") { console.log(JSON.stringify(readTrials(home), null, 2)); process.exit(0); }
if (op === "preflight") { const result = trialPreflight(home, { surface: args[0], taskId: args[1] }); console.log(JSON.stringify(result, null, 2)); process.exit(result.ready ? 0 : 1); }
if (op === "start") { const [surface, taskId] = args; console.log(JSON.stringify(startTrial(home, { surface, taskId }), null, 2)); process.exit(0); }
if (op === "metric") { const [trialId, name, value] = args; console.log(JSON.stringify(recordTrialMetric(home, trialId, { name, value }), null, 2)); process.exit(0); }
if (op === "end") { const [trialId, outcome = "review"] = args; console.log(JSON.stringify(endTrial(home, trialId, { outcome }), null, 2)); process.exit(0); }
console.error("usage: trial status | preflight <surface> <taskId> | start <surface> <taskId> | metric <trialId> <name> <value> | end <trialId> [outcome]"); process.exit(2);
