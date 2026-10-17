// Observation-only usage-reduction advisors. They estimate local contributors
// and recommendations; they never mutate settings, compact context, or launch workers.
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value) => Math.max(0, finite(value));
const rank = (value) => value === "low" || value === "cheap" ? 0 : value === "high" || value === "thorough" ? 2 : 1;

export function estimateContext({ conversationTokens = 0, instructionTokens = 0, selectedFiles = [], toolSchemaTokens = 0, attachments = [], priorOutputTokens = 0, modelWindowTokens = null, warningRatio = 0.7 } = {}) {
  const files = (Array.isArray(selectedFiles) ? selectedFiles : []).map((file) => typeof file === "number" ? { tokens: positive(file) } : { path: file.path || null, tokens: positive(file.tokens ?? file.bytes / 4) });
  const attached = (Array.isArray(attachments) ? attachments : []).map((file) => typeof file === "number" ? { tokens: positive(file) } : { name: file.name || null, tokens: positive(file.tokens ?? file.bytes / 4) });
  const contributors = { conversation: positive(conversationTokens), instructions: positive(instructionTokens), selectedFiles: files.reduce((sum, file) => sum + file.tokens, 0), toolSchemas: positive(toolSchemaTokens), attachments: attached.reduce((sum, file) => sum + file.tokens, 0), priorOutputs: positive(priorOutputTokens) };
  const totalTokens = Object.values(contributors).reduce((sum, value) => sum + value, 0);
  const window = modelWindowTokens == null ? null : positive(modelWindowTokens);
  const ratio = window ? totalTokens / window : null;
  const status = ratio == null ? "unknown" : ratio >= 1 ? "over-window" : ratio >= positive(warningRatio) ? "near-window" : "within-window";
  const advice = [];
  if (contributors.selectedFiles > 0 && contributors.selectedFiles >= totalTokens * 0.5) advice.push("narrow selected files to the smallest needed ranges");
  if (contributors.instructions > 2500) advice.push("move reference material out of always-loaded instructions");
  if (contributors.priorOutputs > totalTokens * 0.35) advice.push("summarize durable decisions before carrying forward prior outputs");
  if (status === "near-window" || status === "over-window") advice.push("checkpoint before adding more context");
  return { contract: "usage-max.context-advisor.v1", contributors, files, attachments: attached, totalTokens, modelWindowTokens: window, ratio, status, advice, evidence: window ? "local estimate against supplied model window" : "local token estimate; provider quota is unknown" };
}

export function recommendModelEffort({ taskClass = "standard", complexity = "standard", reworkRisk = "standard", deadlineMs = null, remainingPercent = null, requestedModel = null, requestedEffort = null, profiles = ["cheap", "standard", "thorough"] } = {}) {
  const requested = requestedModel || requestedEffort ? { model: requestedModel, effort: requestedEffort } : null;
  const constrained = remainingPercent != null && finite(remainingPercent, 100) < 20;
  const urgent = deadlineMs != null && positive(deadlineMs) < 60 * 60 * 1000;
  const score = Math.max(rank(taskClass), rank(complexity), rank(reworkRisk), urgent ? 1 : 0);
  const ordered = profiles.filter((name) => ["cheap", "standard", "thorough"].includes(name));
  const recommendedProfile = ordered[Math.min(score, Math.max(0, ordered.length - 1))] || "standard";
  return { contract: "usage-max.model-advisor.v1", status: requested ? "preserve-explicit-request" : "recommendation-only", requested, recommended: { profile: recommendedProfile, reason: score >= 2 ? "complexity or rework risk warrants thorough verification" : urgent ? "deadline warrants a balanced verification profile" : constrained ? "headroom is limited; use the smallest profile that still meets quality" : "task signals support the smallest adequate profile" }, constrained, urgent, providerControl: "unavailable-unless-approved-adapter", action: "no provider setting changed" };
}

export function assessSubagentROI({ fanOut = 0, expectedOverlap = 0, expectedParallelBenefit = 0, descendantBudget = 0, verificationReserve = 0, baseTokens = 0, perAgentTokens = 0 } = {}) {
  const n = Math.max(0, Math.floor(finite(fanOut))); const overlap = Math.min(1, Math.max(0, finite(expectedOverlap))); const benefit = Math.max(0, finite(expectedParallelBenefit)); const gross = positive(baseTokens) + n * positive(perAgentTokens); const duplicateCost = n * positive(perAgentTokens) * overlap; const reserve = positive(verificationReserve); const netRisk = gross + duplicateCost + reserve; const lowRoi = n > 1 && benefit <= duplicateCost + reserve; const overFanout = n > Math.max(1, Math.floor(positive(descendantBudget)));
  return { contract: "usage-max.subagent-roi.v1", fanOut: n, expectedOverlap: overlap, expectedParallelBenefit: benefit, duplicateCost, verificationReserve: reserve, estimatedUsageRisk: netRisk, status: lowRoi || overFanout ? "review" : n ? "advisable" : "single-agent", reasons: [lowRoi ? "expected parallel benefit does not exceed overlap and verification reserve" : null, overFanout ? "fan-out exceeds descendant budget" : null].filter(Boolean), action: "observation-only; no subagent is started or stopped" };
}

export function analyzeReads(events = [], { oversizedBytes = 100000, unchangedWindow = 3 } = {}) {
  const rows = Array.isArray(events) ? events : []; const byPath = new Map(); const repeated = []; const oversized = [];
  for (const event of rows) { const file = event.path || event.file || "unknown"; const hash = event.hash || event.digest || null; const bytes = positive(event.bytes ?? event.size); if (bytes >= oversizedBytes) oversized.push({ path: file, bytes, advice: "read a targeted range or summary when possible" }); const previous = byPath.get(file); if (previous && hash && previous.hash === hash) { previous.count += 1; if (previous.count >= unchangedWindow) repeated.push({ path: file, count: previous.count, hash, advice: "reuse the unchanged observation unless verification requires a reread" }); } else if (!previous || hash !== previous.hash) byPath.set(file, { hash, count: 1 }); }
  return { contract: "usage-max.read-advisor.v1", events: rows.length, repeatedUnchanged: repeated, oversizedInputs: oversized, status: repeated.length || oversized.length ? "review" : "clear", action: "diagnostic only; legitimate rereads remain allowed" };
}

