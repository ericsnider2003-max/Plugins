// Bounded task loop around the deterministic control-plane primitives. The worker is injected by the caller.
import { canAdmit } from "./admission.mjs";
import { createTask, acquireLease, recordEffect, releaseLease, transitionTask } from "./task-state.mjs";
import { inspectHealth } from "./watchdog.mjs";
import { releaseBudget, reserveBudget } from "./reservations.mjs";
import { retryDelay } from "./task-policy.mjs";
import { chooseExecutionProfile, decideModelEffort } from "./execution-profile.mjs";
import { verifyCompletion } from "./completion-verifier.mjs";
export async function runTaskOnce({ task = null, taskId, idempotencyKey, observation, accountApproved, owner = "worker", now = new Date().toISOString(), execute, verify = null, requiredEffectIds = [], tasks = new Map(), previousObservation = null, observationHistory = [] }) {
  let current = task || createTask({ taskId, idempotencyKey, now });
  const profile = chooseExecutionProfile({ qualityRequired: current.qualityRequired, requested: current.executionProfile, remainingPercent: observation?.window?.usedPercentage == null ? null : 100 - Number(observation.window.usedPercentage) });
  const modelDecision = decideModelEffort({ requestedModel: current.requestedModel, requestedEffort: current.requestedEffort, observedModel: observation?.model?.canonical || observation?.model?.raw || null, observedEffort: observation?.model?.effort || null, provider: observation?.provider || current.provider || null, surface: observation?.surface || current.surface || null, now });
  current = { ...current, executionProfile: profile.profile, modelDecision, updatedAt: now };
  const activeTaskCount = [...tasks.values()].filter((x) => x.taskId !== current.taskId && ["admitted", "running", "checkpointing", "verifying"].includes(x.state) && (!current.provider || x.provider === current.provider) && (!current.accountSlot || x.accountSlot === current.accountSlot)).length;
  const decision = canAdmit({ task: current, observation, accountApproved, now: Date.parse(now), tasks, activeTaskCount, previousObservation, observationHistory });
  if (!decision.allowed) return { task: current, decision, started: false };
  if (current.state === "failed") current = transitionTask(current, "queued", now);
  let reservation = null;
  if (arguments[0]?.reservation?.home && Number.isFinite(Number(arguments[0].reservation.amountPercent))) {
    const cfg = arguments[0].reservation; const result = reserveBudget(cfg.home, { reservationId: cfg.reservationId || `${current.taskId}-${current.attempt}`, taskId: current.taskId, accountSlot: cfg.accountSlot || current.accountSlot || observation.account?.slot || "unknown", windowId: cfg.windowId || observation.window?.id || "unknown", usedPercent: Number(observation.window.usedPercentage), amountPercent: Number(cfg.amountPercent), reservePercent: cfg.reservePercent ?? 10, expiresAt: cfg.expiresAt || new Date(Date.parse(now) + 5 * 60 * 1000).toISOString(), now });
    if (!result.allowed) return { task: current, decision: { ...decision, allowed: false, reason: result.reason }, started: false, reservation: result };
    reservation = { home: cfg.home, reservationId: result.reservation.reservationId };
  }
  if (current.state === "queued" || current.state === "paused_for_usage" || current.state === "paused_for_approval") current = transitionTask(current, "admitted", now);
  if (current.state === "admitted") current = transitionTask(current, "running", now);
  current = acquireLease(current, owner, new Date(Date.parse(now) + 5 * 60 * 1000).toISOString(), now);
  try {
    const result = await execute({ task: current, observation, executionProfile: profile, modelDecision });
    for (const effect of result?.effects || []) current = recordEffect(current, effect, now);
    current = transitionTask(current, "checkpointing", now);
    current = { ...current, checkpoint: result?.checkpoint || current.checkpoint };
    // A checkpoint is a resumable progress boundary, not a completion signal.
    // Workers must explicitly report completion before the task can enter
    // verification; an omitted outcome is therefore treated as unfinished.
    const outcome = result?.outcome || (result?.continue === true ? "continue" : result?.completed === true ? "completed" : null);
    if (outcome === "failed") { const error = new Error(result?.error || "worker reported failure"); error.retryable = result?.retryable !== false; throw error; }
    current = outcome === "completed" ? transitionTask(current, "verifying", now) : transitionTask(current, "running", now);
    current = releaseLease(current, now);
    let verification = null;
    if (outcome === "completed" && typeof verify === "function") {
      const supplied = await verify({ task: current, observation, result });
      verification = verifyCompletion({ task: current, checks: supplied?.checks || [], requiredEffectIds: supplied?.requiredEffectIds || requiredEffectIds });
      current = { ...current, verification, updatedAt: now };
      if (verification.complete) current = transitionTask(current, "completed", now);
    }
    if (reservation) releaseBudget(reservation.home, reservation.reservationId, { now });
    return { task: current, decision, started: true, reservation, verification, health: inspectHealth({ now: Date.parse(now), lastHeartbeatAt: now, lastMeaningfulAt: now }) };
  } catch (error) {
    if (reservation) releaseBudget(reservation.home, reservation.reservationId, { state: "failed", now });
    const retryable = error?.retryable !== false && Number(current.attempt) < Number(current.retry?.maxAttempts || 0); const retryAt = retryable ? new Date(Date.parse(now) + retryDelay(current)).toISOString() : null;
    current = releaseLease({ ...current, state: "failed", retryAt }, now);
    return { task: current, decision, started: true, error: String(error?.message || error) };
  }
}
