// Optional Codex app-server account adapter. It is never invoked implicitly by tests or routing.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { normalizeCodexLimits } from "../../scripts/provider-limits.mjs";
import { normalizeAccountActivity } from "../../scripts/account-activity.mjs";

export function resolveCodexCommand({ platform = process.platform, envPath = process.env.PATH || "" } = {}) {
  const names = platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  for (const folder of envPath.split(path.delimiter).filter(Boolean)) for (const name of names) {
    const candidate = path.join(folder, name); if (fs.existsSync(candidate)) return candidate;
  }
  return names[0];
}

function readJsonLines(child, requestId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = ""; const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error("Codex app-server response timed out")); }, timeoutMs);
    const done = (fn, value) => { clearTimeout(timer); fn(value); };
    child.stdout.on("data", (chunk) => {
      buf += String(chunk);
      for (const line of buf.split(/\r?\n/).slice(0, -1)) {
        try { const row = JSON.parse(line); if (row.id === requestId) return done(resolve, row); } catch { /* wait for a complete JSON line */ }
      }
      buf = buf.split(/\r?\n/).at(-1) || "";
    });
    child.on("error", (e) => done(reject, e)); child.on("exit", (code) => { if (code && !buf) done(reject, new Error(`Codex app-server exited with ${code}`)); });
  });
}

export async function readCodexRateLimits({ command = null, args = ["app-server"], spawnImpl = spawn, timeoutMs = 15000 } = {}) {
  command ||= resolveCodexCommand();
  const child = spawnImpl(command, args, { stdio: ["pipe", "pipe", "ignore"] });
  const initializeId = 1; const readId = 2;
  const send = (id, method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  send(initializeId, "initialize", { clientInfo: { name: "usage-max", version: "0.21.0" } });
  const init = await readJsonLines(child, initializeId, timeoutMs);
  if (init.error) throw new Error(`Codex app-server initialize failed: ${init.error.message || "unknown error"}`);
  send(readId, "account/rateLimits/read");
  const response = await readJsonLines(child, readId, timeoutMs);
  if (response.error) throw new Error(`Codex app-server rate-limit read failed: ${response.error.message || "unknown error"}`);
  const result = response.result || {};
  const normalized = normalizeCodexLimits(result);
  return { capturedAt: new Date().toISOString(), providerEventAt: result.capturedAt || result.observedAt || null, source: "codex-app-server", account: result.account || result.accountId || null, rate_limits: normalized.rate_limits };
}

// Optional account-level activity read. It is explicit and read-only; callers
// must keep this evidence separate from quota windows and local transcripts.
export async function readCodexAccountUsage({ command = null, args = ["app-server"], params = {}, spawnImpl = spawn, timeoutMs = 15000 } = {}) {
  command ||= resolveCodexCommand();
  const child = spawnImpl(command, args, { stdio: ["pipe", "pipe", "ignore"] });
  const send = (id, method, values = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: values })}\n`);
  send(1, "initialize", { clientInfo: { name: "usage-max", version: "0.21.0" } });
  const init = await readJsonLines(child, 1, timeoutMs);
  if (init.error) throw new Error(`Codex app-server initialize failed: ${init.error.message || "unknown error"}`);
  send(2, "account/usage/read", params);
  const response = await readJsonLines(child, 2, timeoutMs);
  if (response.error) throw new Error(`Codex app-server account-usage read failed: ${response.error.message || "unknown error"}`);
  const result = response.result || {};
  return normalizeAccountActivity(result, { provider: "openai", account: result.account || result.accountId || null, source: "codex-app-server-account-usage" });
}
