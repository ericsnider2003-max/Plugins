#!/usr/bin/env node
import os from "node:os";
import { formatSummary, summaryReport } from "./summary.mjs";
const args = process.argv.slice(2); const i = args.indexOf("--days"); const days = i >= 0 ? Number(args[i + 1]) || 1 : 1; const report = summaryReport(process.env.USAGE_MAX_HOME || os.homedir(), { days });
console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatSummary(report));
