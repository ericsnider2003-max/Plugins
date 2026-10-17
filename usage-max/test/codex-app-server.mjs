#!/usr/bin/env node
import assert from "node:assert/strict";
import { readCodexRateLimits, resolveCodexCommand } from "../codex/scripts/codex-app-server.mjs";
assert.equal(resolveCodexCommand({ platform: "win32", envPath: "C:/missing;C:/codex" }), "codex.exe");
function fakeSpawn() {
  const listeners = { data: [], error: [], exit: [] };
  const child = { stdout: { on: (event, fn) => listeners.data.push(fn) }, on: (event, fn) => listeners[event].push(fn), stdin: { writes: [], write(value) { this.writes.push(JSON.parse(value)); if (this.writes.length === 1) setImmediate(() => listeners.data.forEach((fn) => fn(Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }) + "\n")))); else setImmediate(() => listeners.data.forEach((fn) => fn(Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { account: "acct-1", rate_limits: { limit_id: "codex", primary: { used_percent: 42, window_minutes: 10080, resets_at: 1792051200 } } } }) + "\n")))); } }, kill() {} };
  return child;
}
const result = await readCodexRateLimits({ spawnImpl: fakeSpawn, timeoutMs: 1000 });
assert.equal(result.source, "codex-app-server"); assert.equal(result.account, "acct-1"); assert.equal(result.rate_limits.codex_primary.used_percentage, 42);
console.log("Codex app-server adapter tests passed");
