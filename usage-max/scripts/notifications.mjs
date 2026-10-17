// Local notification outbox. Surface bridges can deliver these later; writes are idempotent by noticeId.
import fs from "node:fs";
import path from "node:path";
import { withLock } from "./safefile.mjs";
export function writeNotice(file, notice) {
  if (!notice?.noticeId || !notice.kind || !notice.message) throw new Error("noticeId, kind, and message are required");
  const result = withLock(file, () => { const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((x) => JSON.parse(x)) : []; if (existing.some((x) => x.noticeId === notice.noticeId)) return { written: false, duplicate: true, notice: existing.find((x) => x.noticeId === notice.noticeId) }; const stored = { ...notice, createdAt: notice.createdAt || new Date().toISOString(), deliveredAt: null }; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 }); return { written: true, duplicate: false, notice: stored }; });
  if (!result.ok) throw new Error(result.busy ? "notification outbox is busy; retry the notice" : "notification outbox could not be locked");
  return result.value;
}
