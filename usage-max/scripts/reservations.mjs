import fs from "node:fs";
import path from "node:path";
import { withLock } from "./safefile.mjs";

const file = (home) => path.join(home, ".usage-max", "reservations.jsonl");
const append = (home, value) => { const f = file(home); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 }); };
export function readReservations(home) { const f = file(home); if (!fs.existsSync(f)) return []; return fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((x) => JSON.parse(x)); }
export function currentReservations(home) { const latest = new Map(); for (const row of readReservations(home)) latest.set(row.reservationId, row); return [...latest.values()]; }
export function reserveBudget(home, { reservationId, taskId, accountSlot, windowId = "unknown", usedPercent, amountPercent, reservePercent = 10, expiresAt, now = new Date().toISOString() } = {}) {
  const used = Number(usedPercent); const amount = Number(amountPercent); const reserve = Number(reservePercent);
  const nowMs = Date.parse(now); const expiryMs = Date.parse(expiresAt || "");
  if (!reservationId || !taskId || !accountSlot || !Number.isFinite(used) || !Number.isFinite(amount) || !Number.isFinite(reserve) || amount < 0 || used < 0 || used > 100 || reserve < 0 || reserve >= 100 || !Number.isFinite(nowMs) || !Number.isFinite(expiryMs) || expiryMs <= nowMs) throw new Error("reservation identity, valid allowance, protected reserve, and future expiry are required");
  const result = withLock(file(home), () => {
    const active = currentReservations(home).filter((x) => x.state === "reserved" && x.accountSlot === accountSlot && x.windowId === windowId && Date.parse(x.expiresAt || 0) > nowMs);
    const already = currentReservations(home).find((x) => x.reservationId === reservationId && x.state === "reserved");
    if (already) return { allowed: true, duplicate: true, reservation: already, reservedPercent: active.reduce((n, x) => n + x.amountPercent, 0) };
    const reserved = active.reduce((n, x) => n + Number(x.amountPercent), 0);
    if (used + reserved + amount > 100 - reserve) return { allowed: false, reason: "reservation would consume protected capacity", availablePercent: Math.max(0, 100 - reserve - used - reserved), reservedPercent: reserved };
    const reservation = { contract: "usage-max.reservation.v1", reservationId, taskId, accountSlot, windowId, usedPercent: used, amountPercent: amount, reservePercent: reserve, expiresAt, createdAt: now, state: "reserved" };
    append(home, reservation); return { allowed: true, duplicate: false, reservation, reservedPercent: reserved + amount };
  });
  if (!result.ok) throw new Error(result.busy ? "reservation ledger is busy; retry the reservation" : "reservation ledger could not be locked");
  return result.value;
}
export function releaseBudget(home, reservationId, { state = "released", now = new Date().toISOString() } = {}) {
  const result = withLock(file(home), () => {
    const current = currentReservations(home).find((x) => x.reservationId === reservationId && x.state === "reserved");
    if (!current) return { released: false, reason: "reservation not active" };
    append(home, { ...current, state, releasedAt: now }); return { released: true, reservation: { ...current, state, releasedAt: now } };
  });
  if (!result.ok) throw new Error(result.busy ? "reservation ledger is busy; retry the release" : "reservation ledger could not be locked");
  return result.value;
}
