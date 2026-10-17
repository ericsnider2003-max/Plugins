// Coverage is explicit: absent observation is not zero usage.
const surfaces = ["claude-code", "claude-desktop", "cowork", "chatgpt", "chatgpt-desktop", "codex-desktop", "codex-cli", "codex-cloud", "browser", "mobile"];
export function summarizeCoverage(observations, { now = Date.now(), staleMs = EVIDENCE_FRESHNESS_MS } = {}) {
  const rows = Object.fromEntries(surfaces.map((surface) => [surface, { surface, state: "unavailable", observed: 0, lastCapturedAt: null, authority: "unattributed", freshness: "unknown", model: null, modelKnown: false, effort: null, modelSelection: null }]));
  for (const o of observations || []) {
    if (!rows[o.surface]) continue;
    const row = rows[o.surface]; row.observed += 1;
    if (row.lastCapturedAt && Date.parse(o.capturedAt || 0) <= Date.parse(row.lastCapturedAt)) continue;
    row.lastCapturedAt = o.capturedAt || null;
    row.authority = o.authority || "unattributed";
    const fresh = o.capturedAt && now - Date.parse(o.capturedAt) <= staleMs;
    row.freshness = fresh ? "fresh" : "stale";
    row.state = o.state === "governing" && fresh ? "governing" : o.state === "unavailable" ? "unavailable" : "observing";
    row.model = o.model?.canonical || o.model?.raw || null;
    row.modelKnown = o.model?.known === true;
    row.effort = o.model?.effort || null;
    row.modelSelection = o.data?.modelSelection || null;
  }
  const all = Object.values(rows);
  return { surfaces: rows, measured: all.filter((x) => x.authority === "provider" || x.authority === "local-activity").length, unattributed: all.filter((x) => x.state === "unavailable").map((x) => x.surface), governed: all.filter((x) => x.state === "governing").map((x) => x.surface) };
}
import { EVIDENCE_FRESHNESS_MS } from "./timing.mjs";
