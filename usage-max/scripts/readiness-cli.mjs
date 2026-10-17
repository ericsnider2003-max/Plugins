#!/usr/bin/env node
import os from "node:os";
import { formatReadiness, readinessReport } from "./readiness.mjs";
const args = process.argv.slice(2); const positional = args.filter((x) => !x.startsWith("--")); const home = process.env.USAGE_MAX_HOME || os.homedir(); const report = readinessReport(home, { surface: positional[0] || "codex-cli", taskId: positional[1] || "usage-max-rebuild-0201-trial" }); console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReadiness(report)); process.exit(report.readyForObservationTrial ? 0 : 1);
