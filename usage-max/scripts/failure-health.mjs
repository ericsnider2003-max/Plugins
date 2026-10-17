// Durable health evidence for fail-open integrations. A hook may not block the
// host turn, but a broken governance path must remain visible to health/status.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fileFor = (home) => path.join(home || os.homedir(), ".usage-max", "failures.jsonl");
const safeText = (value) => String(value?.message || value || "unknown failure").replace(/[\r\n]+/g, " ").slice(0, 500);

export function recordFailure({ home = os.homedir(), component = "unknown", event = "unknown", error, now = new Date().toISOString(), severity = "high" } = {}) {
  const file = fileFor(home); const row = { contract: "usage-max.failure.v1", failureId: `${component}:${event}:${Date.now()}`, component, event, severity, error: safeText(error), at: now, resolved: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
  return row;
}

export function readFailureHealth(home = os.homedir(), { now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const file = fileFor(home); if (!fs.existsSync(file)) return [];
  let text; try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const row = JSON.parse(line); const age = now - Date.parse(row.at || 0);
      return row?.contract === "usage-max.failure.v1" && row.resolved !== true && Number.isFinite(age) && age >= 0 && age <= maxAgeMs ? [row] : [];
    } catch { return []; }
  }).slice(-100);
}
