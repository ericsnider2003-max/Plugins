#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { handleMessage, readConfig } from "../browser-adapter/native-host.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-native-host-"));
assert.equal(handleMessage({ type: "ping" }, { home }).ok, true);
assert.equal(handleMessage({ type: "get-config" }, { home }).ok, false);
fs.mkdirSync(path.join(home, ".usage-max"), { recursive: true }); fs.writeFileSync(path.join(home, ".usage-max", "attachment-server.token"), "redacted-native-token\n", { mode: 0o600 });
const config = readConfig(home, 43127); assert.equal(config.ok, true); assert.equal(config.endpoint, "http://127.0.0.1:43127/v1/attachment"); assert.equal(config.token, "redacted-native-token");
assert.equal(handleMessage({ type: "unknown" }, { home }).ok, false);
const host = spawn(process.execPath, [path.resolve("browser-adapter/native-host.mjs")], { env: { ...process.env, USAGE_MAX_HOME: home, USAGE_MAX_ATTACHMENT_PORT: "43127" }, stdio: ["pipe", "pipe", "pipe"] });
const frame = Buffer.from(JSON.stringify({ type: "get-config" })); const packet = Buffer.alloc(4 + frame.length); packet.writeUInt32LE(frame.length, 0); frame.copy(packet, 4); host.stdin.write(packet);
const reply = await new Promise((resolve, reject) => { let buffer = Buffer.alloc(0); const timer = setTimeout(() => reject(new Error("native host response timeout")), 3000); host.stdout.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); if (buffer.length < 4) return; const size = buffer.readUInt32LE(0); if (buffer.length < 4 + size) return; clearTimeout(timer); resolve(JSON.parse(buffer.subarray(4, 4 + size).toString("utf8"))); }); host.on("error", reject); });
assert.equal(reply.ok, true); assert.equal(reply.token, "redacted-native-token"); host.kill();
console.log("browser native host tests passed");
