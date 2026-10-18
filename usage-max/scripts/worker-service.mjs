// Observation-only by default. An explicit caller may supply approved host
// attachments plus a reviewed rollout object for a guarded handoff launch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readText, writeAtomic } from "./safefile.mjs";
import { captureProviderLimits } from "./provider-limits.mjs";
import { defaultObservationLedger } from "./provider-ingest.mjs";
import { readLedger } from "./observation-ledger.mjs";
import { loadTasks, saveTask } from "./task-store.mjs";
import { transitionTask } from "./task-state.mjs";
import { inspectHealth } from "./watchdog.mjs";
import { nextWake } from "./scheduler.mjs";
import { writeNotice } from "./notifications.mjs";
import { deliverOutbox } from "./notification-bridge.mjs";
import { manifest } from "./surface-adapters.mjs";
import { currentTrials, recordTrialMetric } from "./trial.mjs";
import { recoverTasks } from "./recovery.mjs";
import { ingestAttachments } from "./attachments.mjs";
import { routePausedTask } from "./cross-provider.mjs";
import { reconcileSubagents } from "./subagents.mjs";
import { reconcileObservations } from "./reconcile.mjs";
import { launchWorker } from "./worker-adapters.mjs";
import { collectorQueueFile, ingestCollectorQueue } from "./collector-queue.mjs";
import { writeDashboard } from "./dashboard.mjs";
import { loadAccounts } from "./accounts.mjs";
import { decideModelEffort } from "./execution-profile.mjs";
import { retryDecision } from "./task-policy.mjs";
import { refreshAutomaticBundles } from "./context-bridge.mjs";
import { DEFAULT_OBSERVATION_INTERVAL_MS, EVIDENCE_FRESHNESS_MS } from "./timing.mjs";
const stateFile = (home) => path.join(home, ".usage-max", "service.json");
const outboxFile = (home) => path.join(home, ".usage-max", "notifications.jsonl");
const defaultState = (stateCorrupt = false) => ({ mode: "observation-only", running: false, stopRequested: false, lastTickAt: null, intervalMs: DEFAULT_OBSERVATION_INTERVAL_MS, evidenceFreshnessMs: EVIDENCE_FRESHNESS_MS, ...(stateCorrupt ? { stateCorrupt: true } : {}) });
export function serviceState(home = os.homedir()) {
  const file = stateFile(home); const raw = readText(file);
  if (raw === null) return defaultState();
  try {
    const state = JSON.parse(raw);
    if (!state || typeof state !== "object" || state.mode !== "observation-only") return defaultState(true);
    return state;
  } catch { return defaultState(true); }
}
function saveState(home, state) { writeAtomic(stateFile(home), `${JSON.stringify({ ...state, mode: "observation-only" }, null, 2)}\n`, { mode: 0o600 }); return state; }
export async function tick({ home = os.homedir(), now = Date.now(), capture = true, captureOptions = {}, deliver = false, bridge = {}, autoHandoff = true, markRunning = true, launchWorkers = false, workerAttachments = {}, workerApproved = false, rollout = null, intervalMs = null } = {}) {
  const state = serviceState(home); state.mode = "observation-only"; state.running = markRunning ? true : Boolean(state.running); state.stopRequested = false; state.lastTickAt = new Date(now).toISOString();
  let captureResult = null;
  if (capture) captureResult = await captureProviderLimits({ home, ...captureOptions });
  const attachmentResult = ingestAttachments(home, { now });
  const collectorResult = ingestCollectorQueue(collectorQueueFile(home), defaultObservationLedger(home), { now });
  const subagentResult = reconcileSubagents(home, { now });
  for (const stale of subagentResult.stale) writeNotice(outboxFile(home), { noticeId: `subagent-${stale.subagentId}-heartbeat-timeout`, kind: "subagent-stale", message: `Subagent ${stale.subagentId} was marked failed after a heartbeat timeout; review before retrying.` });
  const ledger = readLedger(defaultObservationLedger(home)); const registry = loadAccounts(path.join(home, ".usage-max", "accounts.json")); const accountPolicy = registry.accounts.length ? registry.accounts : null;
  for (const observation of ledger) {
    const slot = observation.account?.slot; if (!slot || observation.account?.approved === true) continue;
    const account = registry.accounts.find((x) => x.slot === slot); if (!account || account.approved === true) continue;
    writeNotice(outboxFile(home), { noticeId: `account-approval-${slot}`, kind: "account-approval", surface: observation.surface || account.surfaces[0] || "all", message: `Account approval required for ${account.provider}/${account.surfaces.join(",")}: approve slot ${slot} before Usage-max can govern or route work. Usage-max will not approve or enable it automatically.` });
  }
  const tasksFile = path.join(home, ".usage-max", "tasks.jsonl"); const recovered = recoverTasks(tasksFile, { now: new Date(now).toISOString() }); const tasks = loadTasks(tasksFile); const contextBridge = refreshAutomaticBundles({ home, tasks, now }); const actions = [];
  const reconciliation = reconcileObservations(ledger, { now, staleMs: EVIDENCE_FRESHNESS_MS });
  for (const finding of reconciliation.filter((x) => ["conflict", "stale"].includes(x.status) || x.anomaly)) {
    const account = finding.account || "unbound";
    const kind = finding.anomaly || `provider-${finding.status}`;
    writeNotice(outboxFile(home), { noticeId: `reconcile-${finding.provider}-${account}-${finding.window || "unknown"}-${kind}`, kind, message: `${finding.provider} ${finding.window || "allowance"} evidence needs review for ${account}: ${finding.reason}. Provider allowance remains authoritative; review before routing.` });
  }
  for (const task of tasks.values()) {
    if (["completed", "dead_letter"].includes(task.state)) continue;
    const relevant = ledger.filter((x) => (task.surface ? x.surface === task.surface : x.provider === task.provider) && (!task.accountSlot || x.account?.slot === task.accountSlot));
    const latest = [...relevant].sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0))[0];
    const latestProvider = relevant.filter((x) => x.authority === "provider").sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0))[0] || null;
    const candidateDecision = decideModelEffort({ requestedModel: task.requestedModel, requestedEffort: task.requestedEffort, observedModel: latest?.model?.canonical || latest?.model?.raw || null, observedEffort: latest?.model?.effort || null, provider: latest?.provider || task.provider || null, surface: latest?.surface || task.surface || null, now: new Date(now).toISOString() });
    const comparable = (x) => x ? JSON.stringify({ ...x, decidedAt: null }) : null;
    const modelDecision = comparable(task.modelDecision) === comparable(candidateDecision) ? task.modelDecision : candidateDecision;
    if (modelDecision !== task.modelDecision) { const updated = { ...task, modelDecision, updatedAt: new Date(now).toISOString() }; saveTask(tasksFile, updated); tasks.set(task.taskId, updated); }
    if (modelDecision.status === "unavailable" || modelDecision.status === "pending") {
      writeNotice(outboxFile(home), { noticeId: `model-decision-${task.taskId}-${modelDecision.status}-${modelDecision.observed?.model || "unknown"}-${modelDecision.requested?.model || "none"}`, kind: "model-decision", surface: task.surface || "all", message: `Task ${task.taskId} model decision is ${modelDecision.status}: ${modelDecision.reason}. Observed=${modelDecision.observed?.model || "unknown"}/${modelDecision.observed?.effort || "unknown"}; requested=${modelDecision.requested?.model || "none"}/${modelDecision.requested?.effort || "none"}.` });
    }
    if (task.state === "verifying" && task.verification && task.verification.complete !== true) writeNotice(outboxFile(home), { noticeId: `verification-${task.taskId}-${task.updatedAt}`, kind: "verification-failed", surface: task.surface || "all", message: `Task ${task.taskId} is awaiting review because completion verification did not pass: ${task.verification.reason}.` });
    if (["attempting", "failed"].includes(task.launch?.state)) writeNotice(outboxFile(home), { noticeId: `launch-review-${task.taskId}-${task.launch.idempotencyKey}-${task.launch.state}`, kind: "task-launch-review", surface: task.surface || task.launch.surface || "all", message: `Task ${task.taskId} has a ${task.launch.state} provider launch record for ${task.launch.provider || task.provider || "unknown"}/${task.launch.surface || task.surface || "unknown"}; review the host result before retrying. Usage-max will not relaunch it automatically.` });
    if (task.state === "failed") {
      const retry = retryDecision(task, { now });
      if (task.retryAt && Date.parse(task.retryAt) > now) writeNotice(outboxFile(home), { noticeId: `retry-${task.taskId}-${task.retryAt}`, kind: "task-retry-scheduled", surface: task.surface || "all", message: `Task ${task.taskId} failed and is eligible for a bounded retry after ${task.retryAt}. Usage-max will not bypass the retry budget.` });
      else if (!retry.allowed && retry.reason === "retry budget exhausted") writeNotice(outboxFile(home), { noticeId: `dead-letter-review-${task.taskId}-${task.attempt}`, kind: "dead-letter-review", surface: task.surface || "all", message: `Task ${task.taskId} exhausted its retry budget and requires review before any further attempt.` });
    }
    const health = inspectHealth({ now, lastHeartbeatAt: task.updatedAt, lastMeaningfulAt: task.updatedAt });
    const wake = nextWake({ observation: latestProvider, now });
    let handoff = null;
    if (autoHandoff && task.state === "paused_for_usage") {
      handoff = routePausedTask({ home, task, observations: ledger, accountPolicy, now, nextAction: task.nextAction || "resume from the saved checkpoint after handoff" });
      if (handoff.handedOff) writeNotice(outboxFile(home), { noticeId: `handoff-${task.taskId}-${handoff.pack.handoffId}`, kind: "task-handoff", message: `Task ${task.taskId} is packaged for ${handoff.pack.destination.provider}/${handoff.pack.destination.surface}; ${handoff.decision?.reason || "destination selected by policy"}. Resume from the credential-free handoff pack.` });
      else if (handoff.decision?.conservative) writeNotice(outboxFile(home), { noticeId: `conservative-${task.taskId}-${handoff.decision.reason}`, kind: "conservative-mode", message: `Task ${task.taskId} remains paused: ${handoff.decision.reason}. No provider was launched and no model/account was changed.` });
    }
    let launch = null;
    const launchTask = handoff?.task || task; const launchDestination = handoff?.pack?.destination || launchTask.handoff?.destination;
    if (launchWorkers && launchTask.state === "handoff_pending" && launchDestination) {
      const destination = launchDestination; const attachment = workerAttachments[destination.surface] || null;
      const destinationAccount = registry.accounts.find((x) => x.slot === destination.accountSlot);
      const accountApproved = Boolean(destinationAccount?.approved && destinationAccount.enabled && destinationAccount.routingEnabled !== false && destinationAccount.provider === destination.provider && destinationAccount.surfaces?.includes(destination.surface) && (!destinationAccount.cooldownUntil || Date.parse(destinationAccount.cooldownUntil) <= now));
      launch = await launchWorker({ task: launchTask, destination, attachment, approved: workerApproved && accountApproved, account: destinationAccount, rollout, now, beforeLaunch: async (plan) => {
        const intent = { ...launchTask, launch: { state: "attempting", idempotencyKey: plan.idempotencyKey, plannedAt: new Date(now).toISOString(), provider: plan.provider, surface: plan.surface, accountSlot: plan.accountSlot } };
        saveTask(tasksFile, intent); tasks.set(intent.taskId, intent);
      } });
      if (launch.launched) {
        const started = transitionTask({ ...launchTask, provider: launch.plan.provider, surface: launch.plan.surface, accountSlot: launch.plan.accountSlot, launch: { state: "started", idempotencyKey: launch.plan.idempotencyKey, startedAt: new Date(now).toISOString(), provider: launch.plan.provider, surface: launch.plan.surface, accountSlot: launch.plan.accountSlot } }, "running", new Date(now).toISOString());
        saveTask(tasksFile, started); tasks.set(started.taskId, started);
      } else {
        if (launch.plan?.allowed === true) { const failed = { ...launchTask, launch: { state: "failed", idempotencyKey: launch.plan.idempotencyKey, failedAt: new Date(now).toISOString(), reason: launch.reason || "launch failed", provider: launch.plan.provider, surface: launch.plan.surface, accountSlot: launch.plan.accountSlot }, updatedAt: new Date(now).toISOString() }; saveTask(tasksFile, failed); tasks.set(failed.taskId, failed); }
        writeNotice(outboxFile(home), { noticeId: `launch-${task.taskId}-${launch.plan?.reason || launch.reason || "refused"}`, kind: "task-launch-refused", message: `Task ${task.taskId} was not launched: ${launch.plan?.reason || launch.reason || "launch refused"}.` });
      }
    }
    actions.push({ taskId: task.taskId, health, wake, handoff, launch });
    if (health.action !== "continue") writeNotice(outboxFile(home), { noticeId: `health-${task.taskId}-${health.action}`, kind: "task-health", message: `Task ${task.taskId}: ${health.action} (${health.reasons.join(", ") || "no reason"})` });
    if (task.state === "paused_for_usage" && wake.state === "waiting-for-reset") writeNotice(outboxFile(home), { noticeId: `wake-${task.taskId}-${wake.wakeAt}`, kind: "task-wake", message: `Task ${task.taskId} remains paused until verified provider reset.` });
    if (task.updatedAt && Date.parse(task.updatedAt) <= now) { /* projection read is intentionally side-effect free */ }
  }
  const bridgeResult = deliver ? await deliverOutbox(outboxFile(home), bridge) : { state: "unavailable", attempted: 0, delivered: 0, pending: 0, reason: "delivery disabled in observation-only tick" };
  const surfaces = manifest();
  const activeTrialRows = currentTrials(home).filter((x) => x.state === "active");
  for (const trial of activeTrialRows) {
    const task = tasks.get(trial.taskId); const relevant = ledger.filter((x) => x.surface === trial.surface || x.provider === task?.provider);
    try { recordTrialMetric(home, trial.trialId, { modelIdentity: relevant.some((x) => x.model?.known === true), providerFreshness: relevant.some((x) => x.authority === "provider" && x.freshness === "fresh"), taskProgress: Boolean(task?.updatedAt && Date.parse(task.updatedAt) <= now), completionEvidence: task?.state === "completed", recoveryEvidence: recovered.length === 0 }, new Date(now).toISOString()); } catch {}
  }
  const activeTrials = currentTrials(home).filter((x) => x.state === "active").length;
  const dashboardFile = writeDashboard(home, { now });
  saveState(home, { ...state, intervalMs: Number.isFinite(intervalMs) ? intervalMs : (state.intervalMs || null), evidenceFreshnessMs: EVIDENCE_FRESHNESS_MS, ledgerCount: ledger.length, taskCount: tasks.size, recoveredCount: recovered.length, attachmentResult, collectorResult, subagentResult, contextBridge, reconciliation, actions, bridge: bridgeResult, surfaces, activeTrials, dashboardFile });
  return { mode: "observation-only", capture: captureResult, ledgerCount: ledger.length, recoveredCount: recovered.length, attachmentResult, collectorResult, subagentResult, contextBridge, reconciliation, taskCount: tasks.size, actions, bridge: bridgeResult, surfaces, activeTrials, dashboardFile };
}
export function stop(home = os.homedir()) { return saveState(home, { ...serviceState(home), running: false, stopRequested: true, stoppedAt: new Date().toISOString() }); }
