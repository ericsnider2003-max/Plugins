#!/usr/bin/env node
// Chrome/Edge native-messaging bridge. It returns only the local Usage-max
// receiver configuration to the trusted extension background worker; page
// content never receives the bearer token.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultHome = () => process.env.USAGE_MAX_HOME || os.homedir();
export function readConfig(home = defaultHome(), port = Number(process.env.USAGE_MAX_ATTACHMENT_PORT || 43127)) {
  const tokenFile = path.join(home, ".usage-max", "attachment-server.token");
  let token = null;
  try { token = fs.readFileSync(tokenFile, "utf8").trim() || null; } catch {}
  if (!token) return { ok: false, error: "Usage-max attachment receiver is not configured" };
  return { ok: true, endpoint: `http://127.0.0.1:${port}/v1/attachment`, token, health: `http://127.0.0.1:${port}/health` };
}

export function handleMessage(message, { home = defaultHome(), port } = {}) {
  if (message?.type === "get-config") return readConfig(home, port);
  if (message?.type === "ping") return { ok: true };
  return { ok: false, error: "unsupported native host message" };
}

function writeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const frame = Buffer.alloc(4 + body.length); frame.writeUInt32LE(body.length, 0); body.copy(frame, 4); process.stdout.write(frame);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  let buffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0); if (length > 64 * 1024) { writeMessage({ ok: false, error: "message too large" }); process.exit(1); }
      if (buffer.length < 4 + length) break;
      const body = buffer.subarray(4, 4 + length); buffer = buffer.subarray(4 + length);
      try { writeMessage(handleMessage(JSON.parse(body.toString("utf8")))); } catch { writeMessage({ ok: false, error: "invalid message" }); }
    }
  });
}
