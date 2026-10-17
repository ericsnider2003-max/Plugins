#!/usr/bin/env node
import os from "node:os";
import { emergencyDisableAdapters, loadAdapterPolicy, setAdapterEnabled } from "./adapter-policy.mjs";
const [op = "list", id, ...rest] = process.argv.slice(2); const home = process.env.USAGE_MAX_HOME || os.homedir();
if (op === "list") { console.log(JSON.stringify(loadAdapterPolicy(home), null, 2)); process.exit(0); }
if (op === "enable" || op === "disable") { if (!id) { console.error(`usage: adapters ${op} <adapter-id> [reason]`); process.exit(2); } console.log(JSON.stringify(setAdapterEnabled(home, id, op === "enable", rest.join(" ")), null, 2)); process.exit(0); }
if (op === "emergency-stop") { console.log(JSON.stringify(emergencyDisableAdapters(home, rest.join(" ") || undefined), null, 2)); process.exit(0); }
console.error("usage: adapters list | enable <adapter-id> | disable <adapter-id> [reason] | emergency-stop [reason]"); process.exit(2);
