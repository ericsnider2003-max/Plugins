#!/usr/bin/env node
import os from "node:os";
import { formatHealthReport, healthReport } from "./health.mjs";
const report = healthReport(process.env.USAGE_MAX_HOME || os.homedir());
console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatHealthReport(report));
process.exitCode = report.status === "error" ? 2 : 0;
