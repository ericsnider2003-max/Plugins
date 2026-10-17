import fs from "node:fs";
import path from "node:path";
import { createHandoffPack } from "./handoff-pack.mjs";
import { transitionTask } from "./task-state.mjs";
import { saveTask } from "./task-store.mjs";

export function requestHandoff({ home, task, destinationProvider, destinationSurface, destinationAccountSlot = null, observation = null, nextAction, files = [], decisions = [], failures = [], workspaceRoot = null, acceptanceCriteria = [], now = new Date().toISOString() }) {
  if (!task || !["running", "paused_for_usage"].includes(task.state)) throw new Error("only running or usage-paused tasks can be handed off");
  const pack = createHandoffPack({ task, observation, sourceProvider: task.provider, sourceSurface: task.surface, destinationProvider, destinationSurface, destinationAccountSlot, nextAction, files, decisions, failures, workspaceRoot, acceptanceCriteria });
  const packFile = path.join(home, ".usage-max", "handoffs", `${pack.handoffId}.json`);
  if (fs.existsSync(packFile)) return { task, pack: JSON.parse(fs.readFileSync(packFile, "utf8")), duplicate: true };
  const next = transitionTask({ ...task, handoff: { handoffId: pack.handoffId, destination: pack.destination, createdAt: now } }, "handoff_pending", now);
  const dir = path.dirname(packFile); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(packFile, `${JSON.stringify(pack, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  saveTask(path.join(home, ".usage-max", "tasks.jsonl"), next);
  return { task: next, pack };
}
