#!/usr/bin/env node
import os from "node:os";
import { taskConsole, stopAllTasks } from "./task-console.mjs";
const [op = "show", ...args] = process.argv.slice(2); const home = process.env.USAGE_MAX_HOME || os.homedir();
if (op === "show") { const report = taskConsole(home); console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : [`task console: ${report.tasks.length} task(s)`, ...report.tasks.map((x) => `${x.taskId}\t${x.state}\t${x.provider || "?"}/${x.surface || "?"}\tmodel=${x.model || "unknown"}\tdecision=${x.modelDecision?.status || "unknown"}\tdeadline=${x.deadlineAt || "none"}\tconcurrency=${x.maxConcurrency || "none"}\tquota=${x.quota?.usedPercentage ?? "?"}%\twake=${x.wake.state}`), `stop-all available: ${report.stopAvailable}`].join("\n")); process.exit(0); }
if (op === "stop-all") { if (!args.includes("--confirm")) { console.error("refused: stop-all requires --confirm"); process.exit(2); } console.log(JSON.stringify(stopAllTasks(home), null, 2)); process.exit(0); }
console.error("usage: task-console show [--json] | stop-all --confirm"); process.exit(2);
