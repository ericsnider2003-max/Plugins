#!/usr/bin/env node
import os from "node:os";
import { serviceState, stop, tick } from "./worker-service.mjs";
import { DEFAULT_INTERVAL_MS, runService } from "./service-runner.mjs";
const [op = "status", ...args] = process.argv.slice(2); const home = process.env.USAGE_MAX_HOME || os.homedir();
if (op === "status") { console.log(JSON.stringify(serviceState(home), null, 2)); process.exit(0); }
if (op === "stop") { console.log(JSON.stringify(stop(home), null, 2)); process.exit(0); }
if (op === "tick") { const result = await tick({ home, capture: !args.includes("--no-capture"), deliver: args.includes("--deliver") }); console.log(JSON.stringify(result, null, 2)); process.exit(0); }
if (op === "run") { const intervalArg = args.indexOf("--interval"); const intervalMs = intervalArg >= 0 ? Number(args[intervalArg + 1]) : DEFAULT_INTERVAL_MS; let requestedStop = false; const requestStop = () => { requestedStop = true; stop(home); }; process.once("SIGINT", requestStop); process.once("SIGTERM", requestStop); const result = await runService({ home, intervalMs, maxTicks: args.includes("--once") ? 1 : Infinity, capture: !args.includes("--no-capture"), deliver: args.includes("--deliver"), shouldStop: () => requestedStop }); console.log(JSON.stringify(result, null, 2)); process.exit(0); }
console.error("usage: service status | tick [--no-capture] [--deliver] | run [--interval <ms>] [--once] [--no-capture] [--deliver] | stop"); process.exit(2);
