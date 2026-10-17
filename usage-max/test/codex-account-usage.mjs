import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readCodexAccountUsage } from "../codex/scripts/codex-app-server.mjs";
function spawnImpl() {
  const child = { stdout: new EventEmitter(), stdin: {}, on(event, handler) { if (event === "exit") this.exitHandler = handler; }, kill() {} };
  child.stdin.write = (line) => { const request = JSON.parse(line); const result = request.method === "initialize" ? {} : { accountId: "acct-redacted", activities: [{ id: "event-1", timestamp: "2026-10-15T08:00:00Z", tokens: 123, requests: 1 }] }; setImmediate(() => child.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`)); };
  return child;
}
const snapshot = await readCodexAccountUsage({ command: "codex", spawnImpl, timeoutMs: 1000 });
assert.equal(snapshot.source, "codex-app-server-account-usage"); assert.equal(snapshot.account, "acct-redacted"); assert.equal(snapshot.activity[0].tokens, 123);
console.log("Codex account activity adapter tests passed");
