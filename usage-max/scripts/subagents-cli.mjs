#!/usr/bin/env node
import os from "node:os";
import { closeSubagent, currentSubagents, heartbeatSubagent, startSubagent } from "./subagents.mjs";
const home = process.env.USAGE_MAX_HOME || os.homedir(); const [op = "status", id, state = "closed"] = process.argv.slice(2);
if (op === "status") console.log(JSON.stringify(currentSubagents(home), null, 2));
else if (op === "start") console.log(JSON.stringify(startSubagent(home, { subagentId: id }), null, 2));
else if (op === "heartbeat") console.log(JSON.stringify(heartbeatSubagent(home, id), null, 2));
else if (op === "close") console.log(JSON.stringify(closeSubagent(home, id, { state }), null, 2));
else { console.error("usage: subagents status | start <id> | heartbeat <id> | close <id> [closed|failed|skipped]"); process.exitCode = 2; }
