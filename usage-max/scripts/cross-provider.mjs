import { requestHandoff } from "./handoff.mjs";
import { EVIDENCE_FRESHNESS_MS } from "./timing.mjs";

function usable(o, { now, reservePercent, accountPolicy = null, task = null }) {
  const age = now - Date.parse(o?.capturedAt || 0); const pct = Number(o?.window?.usedPercentage);
  const policy = accountPolicy?.find?.((x) => x.slot === o?.account?.slot) || accountPolicy?.[o?.account?.slot] || null;
  if (accountPolicy && !policy) return false;
  const cooldown = policy?.cooldownUntil ? Date.parse(policy.cooldownUntil) : NaN;
  const model = o?.model?.canonical || o?.model?.raw || null;
  return o && o.authority === "provider" && o.state === "governing" && o.freshness === "fresh" && o.model?.known === true && !(o.model?.raw && o.model?.provider === "unknown") && (!o.model?.provider || o.model.provider === o.provider) && age >= 0 && age <= EVIDENCE_FRESHNESS_MS && Number.isFinite(pct) && pct < 100 - reservePercent && o.account?.approved === true && (!task?.requestedModel || task.requestedModel === model) && (!task?.requestedEffort || task.requestedEffort === o.model?.effort) && policy?.routingEnabled !== false && (!Number.isFinite(cooldown) || cooldown <= now);
}
export function chooseDestination({ task, observations = [], now = Date.now(), reservePercent = 10, accountPolicy = null } = {}) {
  const candidates = observations.filter((o) => o.provider !== task?.provider && usable(o, { now, reservePercent, accountPolicy, task })).sort((a, b) => Number(a.window.usedPercentage) - Number(b.window.usedPercentage));
  if (!candidates.length) {
    const constrained = observations.some((o) => o.provider !== task?.provider && o.authority === "provider" && o.account?.approved === true && o.freshness === "fresh" && Number.isFinite(Number(o.window?.usedPercentage)));
    return { allowed: false, conservative: constrained, reason: constrained ? "approved providers are observed but no destination has safe reserved headroom" : "no approved destination has fresh provider headroom" };
  }
  const selected = candidates[0]; return { allowed: true, reason: "selected the lowest-usage approved destination with fresh provider evidence and reserve headroom", provider: selected.provider, surface: selected.surface, accountSlot: selected.account?.slot || null, remainingPercent: 100 - Number(selected.window.usedPercentage), observation: selected };
}
export function routePausedTask({ home, task, observations, now = Date.now(), reservePercent = 10, nextAction, files = [], decisions = [], failures = [], accountPolicy = null } = {}) {
  const decision = chooseDestination({ task, observations, now, reservePercent, accountPolicy }); if (!decision.allowed) return { decision, handedOff: false };
  const result = requestHandoff({ home, task, destinationProvider: decision.provider, destinationSurface: decision.surface, destinationAccountSlot: decision.accountSlot, observation: decision.observation, nextAction, files, decisions, failures, now: new Date(now).toISOString() });
  return { decision, handedOff: true, ...result };
}
