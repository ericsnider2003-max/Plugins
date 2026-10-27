const riskWords = /production|delete|migration|security|payment|deploy|public|database|audit/i;
const broadWords = /entire|all|全面|refactor|audit|migrate|build|implement|system/i;

export function classifyWorkflow({ prompt = "", files = 0, risk = null } = {}) {
  const text = String(prompt);
  const highRisk = risk === "high" || riskWords.test(text);
  const broad = Number(files) > 8 || broadWords.test(text);
  return { size: broad ? "broad" : "focused", risk: highRisk ? "high" : "normal", complexity: broad && highRisk ? "large-risk" : broad ? "large" : "small" };
}

export function planWorkflow({ prompt, files = 0, allowance = null, executionMode = "interactive" } = {}) {
  const classification = classifyWorkflow({ prompt, files });
  const constrained = allowance?.state === "red" || Number(allowance?.remainingPercent) < 20;
  const surplus = allowance?.state === "green" && Number(allowance?.projectedUnusedPercent) >= 20;
  let stages = classification.complexity === "small" ? ["direct"] : ["scout", "worker", "verify"];
  if (classification.risk === "high") stages = ["scout", "worker", "verify", "review"];
  return { contract: "usage-max.workflow-plan.v1", mode: "recommendation-only", executionMode, classification, constrained, surplus, stages, rationale: constrained ? "reduce rereads and use bounded stages" : surplus ? "spare allowance supports deeper verification" : "match effort to task size and risk", interactiveNonBlocking: true };
}

export function recommendFromHistory(records = []) {
  const completed = records.filter((x) => x.state === "completed" || x.outcome === "completed");
  const failed = records.filter((x) => x.state === "failed" || x.error);
  const verification = completed.filter((x) => x.verification?.complete === false);
  return { sampleSize: records.length, completed: completed.length, failures: failed.length, verificationFailures: verification.length, recommendation: failed.length > completed.length ? "add a verification stage and smaller worker slices" : verification.length ? "retain verification and require explicit checks before completion" : "reuse the current workflow shape; consider parallel scouts for broad work", confidence: records.length >= 5 ? "measured" : "early-sample" };
}
