import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { tick, stop } from "./worker-service.mjs";
import { DEFAULT_OBSERVATION_INTERVAL_MS } from "./timing.mjs";
export const DEFAULT_INTERVAL_MS = DEFAULT_OBSERVATION_INTERVAL_MS;

const lockFile = (home) => path.join(home, ".usage-max", "service.lock");
export function acquireServiceLock(home = os.homedir()) {
  const file = lockFile(home); fs.mkdirSync(path.dirname(file), { recursive: true });
  try { const handle = fs.openSync(file, "wx"); fs.writeFileSync(handle, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`); fs.closeSync(handle); let released = false; return { file, release() { if (released) return; released = true; try { fs.unlinkSync(file); } catch {} } }; }
  catch (error) {
    let owner = null; try { owner = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    let alive = owner?.pid === process.pid; if (owner?.pid && owner.pid !== process.pid) { try { process.kill(owner.pid, 0); alive = true; } catch {} }
    if (alive) throw new Error(`observation service already running (pid ${owner.pid})`);
    try { fs.unlinkSync(file); } catch {};
    const handle = fs.openSync(file, "wx"); fs.writeFileSync(handle, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`); fs.closeSync(handle); let released = false; return { file, release() { if (released) return; released = true; try { fs.unlinkSync(file); } catch {} } };
  }
}

export async function runService({ home = os.homedir(), intervalMs = DEFAULT_INTERVAL_MS, maxTicks = Infinity, capture = true, deliver = false, tickFn = tick, sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), shouldStop = () => false } = {}) {
  if (!(intervalMs >= 1000)) throw new Error("service interval must be at least 1000ms");
  const lock = acquireServiceLock(home); let count = 0; const results = [];
  try { while (count < maxTicks && !shouldStop()) { results.push(await tickFn({ home, capture, deliver, intervalMs })); count += 1; if (count < maxTicks && !shouldStop()) await sleepFn(intervalMs); } stop(home); return { ticks: count, results }; }
  finally { lock.release(); }
}
