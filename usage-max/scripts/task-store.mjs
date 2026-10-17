// Restart-safe task snapshots. The append-only log is the source; latest state is a projection.
import fs from "node:fs";
import path from "node:path";
import { withLock } from "./safefile.mjs";
export function loadTasks(file) {
  if (!fs.existsSync(file)) return new Map();
  const out = new Map();
  for (const [index, line] of fs.readFileSync(file, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { const task = JSON.parse(line); if (task.taskId) out.set(task.taskId, task); }
    catch (error) { throw new Error(`task history is corrupt at line ${index + 1}: ${error.message}`); }
  }
  return out;
}
export function saveTask(file, task) {
  if (!task?.taskId || !task.updatedAt) throw new Error("taskId and updatedAt are required");
  const result = withLock(file, () => {
    const current = loadTasks(file).get(task.taskId);
    if (current && Date.parse(task.updatedAt) < Date.parse(current.updatedAt)) throw new Error("task update is older than stored state");
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `${JSON.stringify(task)}\n`, { encoding: "utf8", mode: 0o600 }); return task;
  });
  if (!result.ok) throw new Error(result.busy ? "task history is busy; retry the state update" : "task history could not be locked");
  return result.value;
}
export function taskSnapshot(file, taskId) { return loadTasks(file).get(taskId) || null; }
