// Evidence-based completion gate. Checks are supplied by the repository/task adapter.
export function verifyCompletion({ task, checks = [], requiredEffectIds = [] }) {
  const results = checks.map((x) => ({ name: x.name, passed: x.passed === true, evidence: x.evidence || null }));
  const checksOk = results.length > 0 && results.every((x) => x.passed);
  const effectsOk = requiredEffectIds.every((id) => task.effects.some((x) => x.effectId === id && ["committed", "skipped"].includes(x.state)));
  const stateOk = task.state === "verifying";
  return { complete: checksOk && effectsOk && stateOk, checks: results, missingEffects: requiredEffectIds.filter((id) => !task.effects.some((x) => x.effectId === id && ["committed", "skipped"].includes(x.state))), reason: !stateOk ? "task is not verifying" : !checksOk ? "required check failed or is missing" : !effectsOk ? "required effect is not committed" : "all required evidence passed" };
}
