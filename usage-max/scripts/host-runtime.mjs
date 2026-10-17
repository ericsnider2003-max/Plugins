#!/usr/bin/env node
// One observation-only host runtime. It owns the service loop and the
// credential-free loopback receiver; it never launches provider workers.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startAttachmentServer } from "./attachment-server.mjs";
import { runService } from "./service-runner.mjs";
import { stop } from "./worker-service.mjs";
import { DEFAULT_INTERVAL_MS } from "./service-runner.mjs";

export async function runHostRuntime({ home = os.homedir(), port = Number(process.env.USAGE_MAX_ATTACHMENT_PORT || 43127), intervalMs = DEFAULT_INTERVAL_MS, maxTicks = Infinity, capture = true, deliver = false } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("attachment port must be an integer from 0 through 65535");
  const receiver = startAttachmentServer({ home, port });
  await new Promise((resolve, reject) => { receiver.server.once("listening", resolve); receiver.server.once("error", reject); });
  let requestedStop = false;
  const requestStop = () => { requestedStop = true; stop(home); };
  process.once("SIGINT", requestStop); process.once("SIGTERM", requestStop);
  try {
    return await runService({ home, intervalMs, maxTicks, capture, deliver, shouldStop: () => requestedStop });
  } finally {
    receiver.server.close();
    process.removeListener("SIGINT", requestStop); process.removeListener("SIGTERM", requestStop);
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2); const intervalIndex = args.indexOf("--interval"); const intervalMs = intervalIndex >= 0 ? Number(args[intervalIndex + 1]) : DEFAULT_INTERVAL_MS;
  const maxTicks = args.includes("--once") ? 1 : Infinity; const portIndex = args.indexOf("--port"); const port = portIndex >= 0 ? Number(args[portIndex + 1]) : Number(process.env.USAGE_MAX_ATTACHMENT_PORT || 43127);
  try { const result = await runHostRuntime({ home: process.env.USAGE_MAX_HOME || os.homedir(), port, intervalMs, maxTicks, capture: !args.includes("--no-capture"), deliver: args.includes("--deliver") }); console.log(JSON.stringify({ mode: "observation-only", port, ...result })); } catch (error) { console.error(String(error?.stack || error)); process.exitCode = 1; }
}
