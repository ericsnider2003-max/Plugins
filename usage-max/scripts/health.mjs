import os from "node:os";
import path from "node:path";
import { compatibilityReport } from "./compatibility-doctor.mjs";
import { controlReport } from "./control-report.mjs";
import { readOutbox } from "./notification-bridge.mjs";
import { activationStatus } from "./activation.mjs";
import { readFailureHealth } from "./failure-health.mjs";

export function healthReport(home = os.homedir(), { now = Date.now(), activation = null } = {}) {
  const control = controlReport(home, { now }); const compatibility = compatibilityReport(home, { now });
  const activationState = activation || activationStatus(home);
  const surfaces = control.surfaces; const pendingNotices = readOutbox(path.join(home, ".usage-max", "notifications.jsonl")).filter((x) => !x.deliveredAt).length; const failures = readFailureHealth(home, { now });
  const governed = surfaces.filter((x) => x.observation === "supported").map((x) => x.surface); const unavailable = surfaces.filter((x) => x.observation === "unavailable").map((x) => x.surface);
  const next = [];
  if (!control.service.running) next.push(activationState.startup?.registered ? "observation service is registered for user logon; start the host runtime now only if immediate observation is needed" : "start the observation service or install automatic startup");
  if (unavailable.length) next.push("attach and approve only the host surfaces you intend to govern");
  if (compatibility.status !== "pass") next.push("resolve compatibility findings before any rollout review");
  if (control.trials.active) next.push("continue the observation trial until its duration, depth, and evidence gates pass");
  if (pendingNotices) next.push(`${pendingNotices} notification(s) await a supported surface bridge`);
  if (failures.length) next.push(`${failures.length} recent governance failure(s) require review`);
  const status = compatibility.status === "error" || failures.some((x) => x.severity === "critical" || x.severity === "high") ? "error" : control.service.running && !unavailable.length && compatibility.status === "pass" ? "healthy" : "review";
  return { generatedAt: new Date(now).toISOString(), status, mode: control.service.mode || "observation-only", service: control.service, activation: { startup: activationState.startup, hooks: activationState.hooks, nativeHost: activationState.nativeHost, attachmentReceiverConfigured: activationState.attachmentReceiverConfigured }, governed, unavailable, pendingNotices, failures, compatibility, trials: control.trials, next };
}

export function formatHealthReport(report) {
  return [`health: ${report.status} (${report.mode})`, `service: ${report.service.running ? "running" : "stopped"}`, `governed: ${report.governed.join(", ") || "none"}`, `unavailable: ${report.unavailable.join(", ") || "none"}`, `failures: ${report.failures?.length || 0}`, `pending notices: ${report.pendingNotices}`, `trials: ${report.trials.active} active / ${report.trials.total} total`, `next: ${report.next.join("; ") || "no action required"}`].join("\n");
}
