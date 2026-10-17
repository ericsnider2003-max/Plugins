#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { accountHomeFingerprint, loadAccounts, registerAccount, setAccountApproval, setAccountRouting, setAllAccountRouting } from "./accounts.mjs";
import { writeNotice } from "./notifications.mjs";
const [op = "list", ...args] = process.argv.slice(2);
const home = process.env.USAGE_MAX_HOME || os.homedir();
const file = path.join(home, ".usage-max", "accounts.json");
function list() { for (const a of loadAccounts(file).accounts) console.log(`${a.slot}\t${a.provider}\t${a.surfaces.join(",")}\tapproved=${a.approved}\tenabled=${a.enabled}\trouting=${a.routingEnabled !== false ? "on" : "off"}\tcooldown=${a.cooldownUntil || "none"}\thome=${a.homeFingerprint}`); }
function observedProviderAccountId(provider) {
  const cache = path.join(home, ".usage-max", "provider-limits.json");
  try {
    const captures = JSON.parse(fs.readFileSync(cache, "utf8"))?.captures || {};
    const capture = provider === "openai" ? captures.codex : captures.claude;
    return capture?.account || capture?.accountId || null;
  } catch { return null; }
}
if (op === "list") { list(); process.exit(0); }
if (op === "add") {
  const [slot, provider, surfaces, accountHome, providerAccountId = null] = args;
  if (!slot || !provider || !surfaces || !accountHome) { console.error("usage: accounts add <slot> <provider> <surface1,surface2> <configured-home> [provider-account-id]"); process.exit(2); }
  const a = registerAccount(file, { slot, provider, surfaces: surfaces.split(",").map((x) => x.trim()).filter(Boolean), home: accountHome, providerAccountId });
  console.log(`registered ${a.slot}; approval is still required\nhome fingerprint: ${a.homeFingerprint}`); process.exit(0);
}
if (op === "add-observed") {
  const [slot, provider, surface, accountHome] = args;
  if (!slot || !provider || !surface || !accountHome) { console.error("usage: accounts add-observed <slot> <provider> <surface> <configured-home>"); process.exit(2); }
  const observedId = observedProviderAccountId(provider);
  const a = registerAccount(file, { slot, provider, surfaces: [surface], home: accountHome, providerAccountId: observedId });
  console.log(`registered ${a.slot}; approval is still required`);
  console.log(`provider account identity: ${observedId ? "observed and bound" : "not present in the local provider cache"}`);
  console.log(`next: accounts approve ${a.slot}`);
  process.exit(0);
}
if (op === "approve" || op === "revoke") {
  const slot = args[0]; if (!slot) { console.error(`usage: accounts ${op} <slot>`); process.exit(2); }
  const a = setAccountApproval(file, slot, { approved: op === "approve", enabled: op === "approve" }); console.log(`${a.slot}: approved=${a.approved} enabled=${a.enabled}`); process.exit(0);
}
if (op === "request-approval") {
  const slot = args[0]; const account = loadAccounts(file).accounts.find((x) => x.slot === slot);
  if (!account) { console.error(`unknown account slot: ${slot || ""}`); process.exit(2); }
  const notice = writeNotice(path.join(home, ".usage-max", "notifications.jsonl"), { noticeId: `account-approval-${account.slot}`, kind: "account-approval", surface: account.surfaces[0] || "all", message: `Account approval required for ${account.provider}/${account.surfaces.join(",")}: run node scripts/accounts-cli.mjs approve ${account.slot}. Usage-max will not approve or enable this account automatically.` });
  console.log(JSON.stringify({ slot: account.slot, approved: account.approved, noticeId: notice.notice.noticeId, duplicate: notice.duplicate }, null, 2)); process.exit(0);
}
if (op === "route-disable" || op === "route-enable") {
  const slot = args[0]; if (!slot) { console.error(`usage: accounts ${op} <slot> [reason]`); process.exit(2); }
  const a = setAccountRouting(file, slot, { enabled: op === "route-enable", reason: args.slice(1).join(" ") }); console.log(`${a.slot}: routingEnabled=${a.routingEnabled}`); process.exit(0);
}
if (op === "emergency-route-stop") { const registry = setAllAccountRouting(file, { enabled: false, reason: args.join(" ") || "emergency route stop" }); console.log(`routing disabled for ${registry.accounts.length} account slot(s)`); process.exit(0); }
console.error("usage: accounts list | add <slot> <provider> <surfaces> <configured-home> [provider-account-id] | add-observed <slot> <provider> <surface> <configured-home> | request-approval <slot> | approve <slot> | revoke <slot> | route-disable <slot> [reason] | route-enable <slot> | emergency-route-stop [reason]"); process.exit(2);
