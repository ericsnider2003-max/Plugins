import { capabilities } from "./surface-adapters.mjs";

const definitions = [
  { provider: "anthropic", surface: "claude-code", launch: "attachment-required" },
  { provider: "openai", surface: "codex-cli", launch: "attachment-required" },
  { provider: "openai", surface: "chatgpt", launch: "unavailable" },
  { provider: "anthropic", surface: "cowork", launch: "unavailable" },
];
export function workerAdapterDefinitions() { return definitions.map((x) => ({ ...x })); }
export function planWorkerLaunch({ task, destination, attachment = null, approved = false, account = null, rollout = null, now = Date.now() } = {}) {
  if (!task?.taskId || !destination?.surface) return { allowed: false, reason: "task and destination identity are required" };
  if (task.state && task.state !== "handoff_pending") return { allowed: false, reason: "task is not waiting for a handoff launch" };
  if (!task.checkpoint?.digest || !task.checkpoint?.path) return { allowed: false, reason: "durable checkpoint is required before launch" };
  if (!destination.accountSlot) return { allowed: false, reason: "approved destination account slot is required" };
  const caps = capabilities(destination.surface, { attachment, approved });
  if (destination.provider && destination.provider !== caps.provider) return { allowed: false, reason: "destination provider does not match the registered surface", capabilities: caps };
  const accountMatches = account?.slot === destination.accountSlot && account.provider === destination.provider && account.surfaces?.includes(destination.surface) && account.approved === true && account.enabled === true && account.routingEnabled !== false && (!account.cooldownUntil || Date.parse(account.cooldownUntil) <= now);
  if (!accountMatches) return { allowed: false, reason: "matching approved account-registry record is required" };
  const idempotencyKey = `handoff:${task.taskId}:${task.checkpoint.digest}`;
  if (["attempting", "started", "failed"].includes(task.launch?.state) && task.launch.idempotencyKey === idempotencyKey) return { allowed: false, reason: task.launch.state === "attempting" ? "worker launch attempt is already durable; review before retry" : task.launch.state === "failed" ? "worker launch previously failed; review before retry" : "worker launch already recorded for this checkpoint" };
  if (caps.taskLaunch !== "supported") return { allowed: false, reason: "destination launch capability is unavailable", capabilities: caps };
  if (rollout?.mode !== "enforcement-candidate" || rollout.allowed !== true) return { allowed: false, reason: "worker launch requires an explicitly reviewed rollout gate", capabilities: caps };
  return { allowed: true, taskId: task.taskId, provider: caps.provider, surface: destination.surface, accountSlot: destination.accountSlot, checkpoint: task.checkpoint, idempotencyKey, capabilities: caps };
}
export async function launchWorker({ task, destination, attachment, approved = false, account = null, rollout = null, beforeLaunch = null, now = Date.now() } = {}) {
  const plan = planWorkerLaunch({ task, destination, attachment, approved, account, rollout, now }); if (!plan.allowed) return { launched: false, plan };
  if (typeof attachment?.launch !== "function") return { launched: false, plan, reason: "launch attachment disappeared" };
  try {
    if (typeof beforeLaunch === "function") await beforeLaunch(plan);
    const result = await attachment.launch(plan);
    if (result?.accepted === false || result?.started === false) return { launched: false, plan, result, reason: "launch attachment rejected the request" };
    return { launched: true, plan, result };
  } catch (error) { return { launched: false, plan, reason: String(error?.message || error) }; }
}
