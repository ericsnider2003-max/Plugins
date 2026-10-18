// Surface bridge boundary. No provider UI is assumed to exist; unavailable is explicit.
import fs from "node:fs";
import { withLock } from "./safefile.mjs";
export function readOutbox(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
}
export function acknowledgeOutbox(file, noticeIds = []) {
  const wanted = new Set(noticeIds.filter((x) => typeof x === "string")); const result = withLock(file, () => { const notices = readOutbox(file); let acknowledged = 0; for (const notice of notices) if (wanted.has(notice.noticeId) && !notice.deliveredAt) { notice.deliveredAt = new Date().toISOString(); acknowledged += 1; } if (acknowledged) fs.writeFileSync(file, `${notices.map((x) => JSON.stringify(x)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 }); return { acknowledged, pending: notices.filter((x) => !x.deliveredAt).length }; });
  if (!result.ok) throw new Error(result.busy ? "notification outbox is busy; retry the acknowledgement" : "notification outbox could not be locked");
  return result.value;
}
export async function deliverOutbox(file, { surface = "unknown", deliver = null } = {}) {
  const notices = readOutbox(file); const pending = notices.filter((x) => !x.deliveredAt);
  if (!deliver) return { state: "unavailable", attempted: 0, delivered: 0, pending: pending.length, reason: `no supported ${surface} notification bridge` };
  let delivered = 0; const results = []; const outcomes = new Map(); const attemptedAt = new Date().toISOString();
  for (const notice of pending) {
    try { await deliver(notice); delivered += 1; outcomes.set(notice.noticeId, { delivered: true, deliveredAt: new Date().toISOString() }); results.push({ noticeId: notice.noticeId, delivered: true }); }
    catch (error) { const reason = String(error?.message || error); outcomes.set(notice.noticeId, { delivered: false, reason }); results.push({ noticeId: notice.noticeId, delivered: false, reason }); }
  }
  const result = withLock(file, () => { const latest = readOutbox(file); for (const notice of latest) { const outcome = outcomes.get(notice.noticeId); if (!outcome || notice.deliveredAt) continue; notice.deliveryAttempts = Number(notice.deliveryAttempts || 0) + 1; notice.lastAttemptAt = attemptedAt; if (outcome.delivered) { notice.deliveredAt = outcome.deliveredAt; delete notice.deliveryError; } else notice.deliveryError = outcome.reason; } fs.writeFileSync(file, `${latest.map((x) => JSON.stringify(x)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 }); return latest; });
  if (!result.ok) return { state: "unavailable", attempted: pending.length, delivered: 0, pending: pending.length, reason: "notification outbox is busy; retry delivery" };
  return { state: "observing", attempted: pending.length, delivered, pending: pending.length - delivered, results };
}
