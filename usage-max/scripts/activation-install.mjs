// One-time, per-user observation-service activation. Planning is side-effect
// free; applying the plan is explicit and never enables worker enforcement.
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { DEFAULT_INTERVAL_MS } from "./service-runner.mjs";

export const TASK_NAME = "Usage-max Observation Service";

export function startupPlan({ root = process.cwd(), home = os.homedir(), nodePath = process.execPath, platform = process.platform, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (!(intervalMs >= 1000)) throw new Error("activation interval must be at least 1000ms");
  const script = path.join(root, "scripts", "host-runtime.mjs");
  const args = [script, "run", "--interval", String(intervalMs)];
  const command = [nodePath, ...args].map((x) => `"${String(x).replaceAll('"', '\\"')}"`).join(" ");
  if (platform === "win32") return { platform, taskName: TASK_NAME, home, command, createArgs: ["/Create", "/TN", TASK_NAME, "/SC", "ONLOGON", "/RL", "LIMITED", "/TR", `${command}`, "/F"], deleteArgs: ["/Delete", "/TN", TASK_NAME, "/F"], registryKey: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", registryAddArgs: ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", TASK_NAME, "/t", "REG_SZ", "/d", command, "/f"], registryDeleteArgs: ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", TASK_NAME, "/f"], safety: "observation-only; no provider worker launch or enforcement" };
  return { platform, taskName: TASK_NAME, home, command, createArgs: null, deleteArgs: null, safety: "observation-only; use the host scheduler to invoke this command" };
}

export function applyStartupPlan(plan, { spawn = spawnSync } = {}) {
  if (!plan?.createArgs || plan.platform !== "win32") return { applied: false, reason: "automatic host registration is only implemented for Windows; use the printed command on another platform" };
  const result = spawn("schtasks", plan.createArgs, { encoding: "utf8", windowsHide: true });
  if (result.status === 0) return { applied: true, method: "schtasks", taskName: plan.taskName, safety: plan.safety };
  const fallback = spawn("reg", plan.registryAddArgs, { encoding: "utf8", windowsHide: true });
  if (fallback.status !== 0) throw new Error(String(fallback.stderr || result.stderr || result.stdout || "startup registration failed").trim());
  return { applied: true, method: "hkcu-run-fallback", taskName: plan.taskName, safety: plan.safety, schedulerError: String(result.stderr || result.stdout || "").trim() };
}

export function removeStartupPlan(plan, { spawn = spawnSync } = {}) {
  if (!plan?.deleteArgs || plan.platform !== "win32") return { removed: false, reason: "automatic host registration is only implemented for Windows" };
  const result = spawn("schtasks", plan.deleteArgs, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 && !/does not exist|cannot find/i.test(String(result.stderr || result.stdout))) throw new Error(String(result.stderr || result.stdout || "schtasks removal failed").trim());
  const fallback = spawn("reg", plan.registryDeleteArgs, { encoding: "utf8", windowsHide: true });
  if (fallback.status !== 0 && !/unable to find|does not exist|cannot find/i.test(String(fallback.stderr || fallback.stdout))) throw new Error(String(fallback.stderr || fallback.stdout || "startup fallback removal failed").trim());
  return { removed: true, taskName: plan.taskName };
}
