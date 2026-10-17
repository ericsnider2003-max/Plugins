#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startAttachmentServer } from "./attachment-server.mjs";
const [op = "serve", ...args] = process.argv.slice(2); const home = process.env.USAGE_MAX_HOME || os.homedir();
if (op === "serve") { const i = args.indexOf("--port"); const port = i >= 0 ? Number(args[i + 1]) : 0; const receiver = startAttachmentServer({ home, port }); await new Promise((resolve) => receiver.server.on("listening", resolve)); const address = receiver.address(); console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}/v1/attachment`, token: receiver.token, health: `http://127.0.0.1:${address.port}/health` }, null, 2)); process.on("SIGINT", () => receiver.server.close(() => process.exit(0))); process.on("SIGTERM", () => receiver.server.close(() => process.exit(0))); }
else if (op === "native-host") { const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); const result = spawnSync(process.execPath, [path.join(root, "scripts", "browser-native-host.mjs"), ...args], { stdio: "inherit", windowsHide: true }); process.exit(result.status ?? 1); }
else { console.error("usage: attachments serve [--port <port>] | attachments native-host --extension-id <id> [--apply] [--edge]"); process.exit(2); }
