// Local account-slot registry. Stores fingerprints and approval state, never credentials or full paths.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withLock } from "./safefile.mjs";

const stablePath = (value) => String(value || "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
const fingerprint = (value) => crypto.createHash("sha256").update(stablePath(value)).digest("hex");

export const emptyRegistry = () => ({ contract: "usage-max.account-registry.v1", version: 1, accounts: [] });
export function loadAccounts(file) {
  try { const value = JSON.parse(fs.readFileSync(file, "utf8")); return value?.contract === "usage-max.account-registry.v1" && Array.isArray(value.accounts) ? value : emptyRegistry(); } catch { return emptyRegistry(); }
}
function save(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(tmp, file); }
function update(file, fn) { const result = withLock(file, () => fn(loadAccounts(file))); if (!result.ok) throw new Error(result.busy ? "account registry is busy; retry the update" : "account registry could not be locked"); return result.value; }

export function registerAccount(file, { slot, provider, surfaces, home, providerAccountId = null }) {
  if (!slot || !provider || !Array.isArray(surfaces) || !home) throw new Error("slot, provider, surfaces, and home are required");
  return update(file, (registry) => { if (registry.accounts.some((x) => x.slot === slot)) throw new Error(`account slot already exists: ${slot}`); registry.accounts.push({ contract: "usage-max.account-slot.v1", slot, provider, providerAccountId, surfaces: [...new Set(surfaces)], homeFingerprint: fingerprint(home), approved: false, enabled: false, routingEnabled: true, cooldownUntil: null, approvedAt: null, notes: "" }); save(file, registry); return registry.accounts.at(-1); });
}

export function setAccountApproval(file, slot, { approved, enabled = approved, approvedAt = new Date().toISOString() }) {
  if (typeof approved !== "boolean") throw new Error("approved must be boolean");
  return update(file, (registry) => { const account = registry.accounts.find((x) => x.slot === slot); if (!account) throw new Error(`unknown account slot: ${slot}`); account.approved = approved; account.enabled = Boolean(enabled && approved); account.approvedAt = approved ? approvedAt : null; save(file, registry); return account; });
}

export function accountCanRun(file, slot, provider, surface) {
  const a = loadAccounts(file).accounts.find((x) => x.slot === slot);
  return Boolean(a?.approved && a.enabled && a.routingEnabled !== false && (!a.cooldownUntil || Date.parse(a.cooldownUntil) <= Date.now()) && a.provider === provider && a.surfaces.includes(surface));
}

export function setAccountRouting(file, slot, { enabled = true, cooldownUntil = null, reason = "" } = {}) {
  return update(file, (registry) => { const account = registry.accounts.find((x) => x.slot === slot); if (!account) throw new Error(`unknown account slot: ${slot}`); if (typeof enabled !== "boolean") throw new Error("routing enabled must be boolean"); account.routingEnabled = enabled; account.cooldownUntil = cooldownUntil; account.notes = reason ? String(reason) : account.notes || ""; save(file, registry); return account; });
}

export function setAllAccountRouting(file, { enabled = false, reason = "emergency route stop" } = {}) {
  return update(file, (registry) => { for (const account of registry.accounts) { account.routingEnabled = Boolean(enabled); account.cooldownUntil = null; account.notes = String(reason); } save(file, registry); return registry; });
}

export function resolveAccount(registry, { provider, surface, home = null, providerAccountId = null } = {}) {
  return resolveAccountMatch(registry, { provider, surface, home, providerAccountId }).account;
}

export function resolveAccountMatch(registry, { provider, surface, home = null, providerAccountId = null } = {}) {
  const candidates = (registry?.accounts || []).filter((x) => x.provider === provider && x.surfaces.includes(surface));
  if (!candidates.length) return { account: null, reason: "no-account-for-surface" };
  const matched = candidates.filter((x) => (providerAccountId && x.providerAccountId ? x.providerAccountId === providerAccountId : true) && (home ? x.homeFingerprint === fingerprint(home) : true));
  if (matched.length !== 1) {
    const identityMismatch = candidates.some((x) => providerAccountId && x.providerAccountId && x.providerAccountId !== providerAccountId) || candidates.some((x) => home && x.homeFingerprint !== fingerprint(home));
    return { account: null, reason: identityMismatch ? "account-identity-mismatch" : "ambiguous-account" };
  }
  const account = matched[0];
  return { account: { slot: account.slot, approved: Boolean(account.approved && account.enabled), providerAccountId: account.providerAccountId || null, routingEnabled: account.routingEnabled !== false, cooldownUntil: account.cooldownUntil || null }, reason: null };
}

export { fingerprint as accountHomeFingerprint };
