import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tick } from "./worker-service.mjs";

export async function autoObserve({ home = os.homedir(), now = Date.now(), input = {} } = {}) {
  try {
    const result = await tick({ home, now, capture: false, deliver: false, autoHandoff: true, markRunning: false });
    const file = path.join(home, ".usage-max", "activation.json"); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify({ mode: "observation-only", source: input.hook_event_name || "host-hook", lastObservedAt: new Date(now).toISOString(), surface: input.surface || null, taskCount: result.taskCount, recoveredCount: result.recoveredCount })}\n`, { encoding: "utf8", mode: 0o600 });
    return result;
  } catch (error) { return { mode: "observation-only", failed: true, reason: String(error?.message || error) }; }
}
