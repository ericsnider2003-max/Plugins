// Append-only, replay-safe observation storage. Provider adapters can use this without changing routing yet.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const omit = (value, key) => {
  if (Array.isArray(value)) return value.map((v) => omit(v, key));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== key).map(([k, v]) => [k, omit(v, key)]));
};
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
};
const digest = (value) => crypto.createHash("sha256").update(stable(value)).digest("hex");

export function observationFingerprint(observation) { return digest(omit(observation, "observationId")); }

export function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { return { state: "quarantined", data: { reason: "invalid ledger line", line: index + 1 } }; }
  });
}

export function reconcileObservation(observation, previous = []) {
  const current = { ...observation, fingerprint: observationFingerprint(observation) };
  if (current.state === "unavailable" || current.state === "quarantined") return current;
  // Quota-window invariants apply to provider snapshots only. Local activity
  // has a different authority domain and must remain available for
  // provider-vs-local reconciliation rather than being quarantined as if it
  // were an allowance reading.
  if (current.authority !== "provider") return current;
  const candidates = previous.filter((x) => x.provider === current.provider && x.authority === "provider" && x.account?.slot === current.account?.slot && x.window?.id === current.window?.id && x.state !== "quarantined");
  const last = candidates.sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0))[0];
  const providerAt = Date.parse(current.providerEventAt || current.capturedAt || 0);
  const lastProviderAt = Date.parse(last?.providerEventAt || last?.capturedAt || 0);
  const reset = Date.parse(current.window?.resetsAt || 0);
  const lastReset = Date.parse(last?.window?.resetsAt || 0);
  let reason = null;
  if (last && providerAt && lastProviderAt && providerAt < lastProviderAt) reason = "provider event is older than the accepted observation";
  else if (last && reset && lastReset && reset < lastReset) reason = "reset timestamp moved backward without a proven reset or account change";
  else if (last && current.window?.usedPercentage != null && last.window?.usedPercentage != null && current.window.usedPercentage < last.window.usedPercentage && reset === lastReset) reason = "usage moved backward inside the same window";
  if (reason) return { ...current, state: "quarantined", freshness: "unknown", data: { ...(current.data || {}), reason } };
  return current;
}

export function appendObservation(file, observation) {
  const previous = readLedger(file);
  const next = reconcileObservation(observation, previous);
  const duplicate = previous.find((x) => x.fingerprint === next.fingerprint || (x.observationId && x.observationId === next.observationId));
  if (duplicate) return { added: false, duplicate: true, observation: duplicate };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(next)}\n`, { encoding: "utf8", mode: 0o600 });
  return { added: true, duplicate: false, observation: next };
}
