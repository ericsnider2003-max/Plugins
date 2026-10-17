#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activationStatus, formatActivationStatus } from "./activation.mjs";
import { applyStartupPlan, removeStartupPlan, startupPlan } from "./activation-install.mjs";
const report = activationStatus(process.env.USAGE_MAX_HOME || os.homedir()); console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatActivationStatus(report));
const op = process.argv[2];
if (op === "install") {
  const plan = startupPlan({ root: path.dirname(path.dirname(fileURLToPath(import.meta.url))), home: process.env.USAGE_MAX_HOME || os.homedir() });
  console.log(JSON.stringify({ ...plan, applied: false, next: "rerun with --apply to register the per-user observation-only startup task" }, null, 2));
  if (process.argv.includes("--apply")) console.log(JSON.stringify(applyStartupPlan(plan), null, 2));
  process.exit(0);
}
if (op === "remove") {
  const plan = startupPlan({ root: path.dirname(path.dirname(fileURLToPath(import.meta.url))), home: process.env.USAGE_MAX_HOME || os.homedir() });
  console.log(JSON.stringify(removeStartupPlan(plan), null, 2)); process.exit(0);
}
