import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = (home) => path.join(home, ".usage-max", "subagents.jsonl");
const append = (home, value) => { const f = file(home); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 }); };
export function readSubagents(home = os.homedir()) { const f = file(home); if (!fs.existsSync(f)) return []; return fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((x) => JSON.parse(x)); }
export function currentSubagents(home = os.homedir()) { const latest = new Map(); for (const row of readSubagents(home)) latest.set(row.subagentId, row); return [...latest.values()]; }
export function startSubagent(home, { subagentId, taskId = null, provider = null, model = null, now = new Date().toISOString() } = {}) {
  if (!subagentId) throw new Error("subagentId is required"); const current = currentSubagents(home).find((x) => x.subagentId === subagentId);
  if (current && ["running", "starting"].includes(current.state)) return { duplicate: true, subagent: current };
  const subagent = { contract: "usage-max.subagent.v1", subagentId, taskId, provider, model, state: "running", startedAt: now, lastHeartbeatAt: now, closedAt: null, failure: null }; append(home, subagent); return { duplicate: false, subagent };
}
export function heartbeatSubagent(home, subagentId, now = new Date().toISOString()) {
  const current = currentSubagents(home).find((x) => x.subagentId === subagentId && x.state === "running"); if (!current) return { updated: false, reason: "running subagent not found" }; const next = { ...current, lastHeartbeatAt: now }; append(home, next); return { updated: true, subagent: next };
}
export function closeSubagent(home, subagentId, { state = "closed", failure = null, now = new Date().toISOString() } = {}) {
  if (!["closed", "failed", "skipped"].includes(state)) throw new Error("invalid terminal subagent state"); const current = currentSubagents(home).find((x) => x.subagentId === subagentId && !["closed", "failed", "skipped"].includes(x.state)); if (!current) return { closed: false, reason: "subagent is not open" }; const next = { ...current, state, closedAt: now, failure }; append(home, next); return { closed: true, subagent: next };
}
export function reconcileSubagents(home = os.homedir(), { now = Date.now(), staleMs = 30 * 60 * 1000 } = {}) {
  const nowIso = new Date(now).toISOString(); const stale = [];
  for (const current of currentSubagents(home)) { const last = Date.parse(current.lastHeartbeatAt || current.startedAt || 0); if (current.state === "running" && (!Number.isFinite(last) || now - last > staleMs)) { const result = closeSubagent(home, current.subagentId, { state: "failed", failure: "heartbeat timeout; external worker state requires review", now: nowIso }); if (result.closed) stale.push(result.subagent); } }
  return { stale, active: currentSubagents(home).filter((x) => x.state === "running").length };
}
