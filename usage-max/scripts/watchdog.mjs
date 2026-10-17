// Local, no-model watchdog classification. It recommends state; a worker decides whether to pause.
export function inspectHealth({ now = Date.now(), lastHeartbeatAt = null, lastMeaningfulAt = null, failures = 0, repeatedToolCalls = 0, contextTokens = 0, contextLimit = 0, heartbeatMs = 120000, stallMs = 300000, failureLimit = 3, repeatLimit = 5, contextLimitPct = 0.9 } = {}) {
  const age = (x) => x ? now - Date.parse(x) : Infinity;
  const reasons = [];
  if (age(lastHeartbeatAt) > heartbeatMs) reasons.push("heartbeat-missed");
  if (age(lastMeaningfulAt) > stallMs) reasons.push("meaningful-progress-stalled");
  if (failures >= failureLimit) reasons.push("error-cascade");
  if (repeatedToolCalls >= repeatLimit) reasons.push("repeated-tool-loop");
  if (contextLimit > 0 && contextTokens / contextLimit >= contextLimitPct) reasons.push("context-cliff");
  const action = reasons.includes("error-cascade") || reasons.includes("repeated-tool-loop") ? "circuit-open" : reasons.length ? "pause-and-checkpoint" : "continue";
  return { action, reasons };
}
