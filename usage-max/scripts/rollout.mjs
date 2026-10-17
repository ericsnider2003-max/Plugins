// Rollout policy. Observation-only is immutable default; enforcement requires
// explicit approval plus evidence and a kill switch that can revoke it.
import { evaluateTrial } from "./trial.mjs";
export function rolloutDecision({ requested = "observation-only", approved = false, killSwitch = false, evidence = {}, trial = null } = {}) {
  if (killSwitch) return { mode: "observation-only", allowed: false, reason: "kill switch active" };
  if (requested !== "enforcement") return { mode: "observation-only", allowed: true, reason: "observation-only is the default" };
  const required = ["modelIdentity", "providerFreshness", "taskProgress", "completionEvidence", "recoveryEvidence"];
  const missing = required.filter((x) => evidence[x] !== true);
  if (!approved) return { mode: "observation-only", allowed: false, reason: "explicit rollout approval required", missing };
  if (missing.length) return { mode: "observation-only", allowed: false, reason: "trial evidence incomplete", missing };
  const trialGate = evaluateTrial(trial || {}); if (!trialGate.ready) return { mode: "observation-only", allowed: false, reason: trialGate.reason, missing: trialGate.missing };
  return { mode: "enforcement-candidate", allowed: false, reason: "enforcement activation is a separate reviewed release", missing: [] };
}
