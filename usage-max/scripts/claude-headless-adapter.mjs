import { spawn } from "node:child_process";
import { governanceReminder } from "./task-governance.mjs";
export function buildClaudePrompt(task) {
  return `${governanceReminder(task, "worker-start")}\nTask: ${task.taskId}\nCheckpoint: ${task.checkpoint?.path || "none"} digest=${task.checkpoint?.digest || "none"}\nPerform one bounded slice and return a durable checkpoint. If unfinished, report continuation explicitly. A final prose claim is not completion without verification. Emit one final line beginning with USAGE_MAX_RESULT: followed by JSON containing outcome (continue|completed|failed), optional checkpoint, effects, and error.`;
}
export function parseClaudeOutput(stdout) {
  const line = String(stdout || "").split(/\r?\n/).reverse().find((x) => x.startsWith("USAGE_MAX_RESULT:"));
  if (!line) return { parsed: false, reason: "structured Usage-max result marker is missing" };
  try { const value = JSON.parse(line.slice("USAGE_MAX_RESULT:".length).trim()); return value && typeof value === "object" ? { parsed: true, value } : { parsed: false, reason: "result is not an object" }; } catch (error) { return { parsed: false, reason: `invalid result JSON: ${error.message}` }; }
}
export function runClaudeSession({ task, command = "claude", args = [], cwd = process.cwd(), maxTurns = 40, timeoutMs = 60 * 60 * 1000, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnFn(command, ["-p", buildClaudePrompt(task), "--max-turns", String(maxTurns), ...args], { cwd, windowsHide: true });
    let stdout = "", stderr = "", settled = false;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    child.stdout?.on("data", (x) => { stdout += x; }); child.stderr?.on("data", (x) => { stderr += x; });
    child.on("error", (error) => finish({ outcome: "failed", retryable: false, error: String(error.message || error), stdout, stderr }));
    child.on("close", (code, signal) => { const parsed = parseClaudeOutput(stdout); finish({ ...(parsed.parsed ? parsed.value : { outcome: code === 0 ? "completed" : "failed" }), exitCode: code, signal, stdout, stderr, structured: parsed.parsed, parseReason: parsed.reason || null, retryable: code !== 0 }); });
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ outcome: "failed", retryable: true, error: "headless worker timeout", stdout, stderr }); }, timeoutMs);
  });
}
