#!/usr/bin/env node
import os from "node:os";
import { compatibilityReport, formatCompatibilityReport } from "./compatibility-doctor.mjs";
const report = compatibilityReport(process.env.USAGE_MAX_HOME || os.homedir());
console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatCompatibilityReport(report));
process.exitCode = report.status === "error" ? 2 : report.status === "review" ? 1 : 0;
