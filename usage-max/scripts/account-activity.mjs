// Account activity is deliberately separate from local token/turn observations.
// A provider-owned activity read may explain account movement, but it must not
// be merged into local totals or treated as a quota percentage.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const iso = (value) => { const date = new Date(typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);

export function normalizeAccountActivity(raw, { provider = "unknown", account = null, source = "provider-account-activity", capturedAt = Date.now() } = {}) {
  if (!raw || typeof raw !== "object") throw new Error("account activity response must be an object");
  const rows = Array.isArray(raw) ? raw : (raw.activity || raw.activities || raw.usage || raw.data || raw.rows || []);
  if (!Array.isArray(rows)) throw new Error("account activity response has no activity rows");
  const activity = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const at = iso(row.timestamp || row.created_at || row.createdAt || row.time || row.date);
    const tokens = Number(row.tokens ?? row.total_tokens ?? row.totalTokens ?? row.usage?.total_tokens);
    const requests = Number(row.requests ?? row.request_count ?? row.requestCount);
    if (!at && !Number.isFinite(tokens) && !Number.isFinite(requests)) return [];
    return [{
      eventId: String(row.event_id || row.eventId || row.id || digest(row)),
      providerEventAt: at,
      model: typeof row.model === "string" ? row.model : (typeof row.model_id === "string" ? row.model_id : null),
      surface: typeof row.surface === "string" ? row.surface : null,
      tokens: Number.isFinite(tokens) && tokens >= 0 ? tokens : null,
      requests: Number.isFinite(requests) && requests >= 0 ? requests : null,
      attributed: Boolean(row.attributed === true || row.session_id || row.sessionId),
    }];
  });
  return { contract: "usage-max.account-activity.v1", activityId: `activity-${digest({ provider, account, source, capturedAt, activity })}`, provider, account: account ? String(account) : null, source, capturedAt: iso(capturedAt), activity };
}

export function summarizeAccountActivity(snapshot, { localTokens = null } = {}) {
  const rows = Array.isArray(snapshot?.activity) ? snapshot.activity : [];
  const providerTokens = rows.reduce((sum, row) => sum + (Number.isFinite(row.tokens) ? row.tokens : 0), 0);
  const providerRequests = rows.reduce((sum, row) => sum + (Number.isFinite(row.requests) ? row.requests : 0), 0);
  const measuredLocal = Number(localTokens);
  return { providerTokens, providerRequests, activityRows: rows.length, attributedRows: rows.filter((x) => x.attributed).length, unattributedRows: rows.filter((x) => !x.attributed).length, localTokens: Number.isFinite(measuredLocal) ? measuredLocal : null, unattributedDelta: Number.isFinite(measuredLocal) ? Math.max(0, providerTokens - measuredLocal) : null, comparison: Number.isFinite(measuredLocal) ? "provider-versus-local" : "provider-only" };
}

export function activityLedgerFile(home) { return path.join(home, ".usage-max", "account-activity.jsonl"); }
export function appendAccountActivity(file, snapshot) { if (!snapshot?.activityId) throw new Error("activity snapshot is missing activityId"); fs.mkdirSync(path.dirname(file), { recursive: true }); const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : []; if (existing.some((line) => { try { return JSON.parse(line).activityId === snapshot.activityId; } catch { return false; } })) return { appended: false, duplicate: true, snapshot }; fs.appendFileSync(file, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: 0o600 }); return { appended: true, duplicate: false, snapshot }; }
export function readAccountActivity(file) { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { const value = JSON.parse(line); return value?.contract === "usage-max.account-activity.v1" ? [value] : []; } catch { return []; } }); }
