import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyRegistry, registerAccount, resolveAccount, resolveAccountMatch } from "../scripts/accounts.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-account-identity-"));
const file = path.join(home, "accounts.json"); fs.writeFileSync(file, JSON.stringify(emptyRegistry()));
registerAccount(file, { slot: "openai-primary", provider: "openai", surfaces: ["chatgpt-desktop"], home: path.join(home, "codex"), providerAccountId: "acct-good" });
const registry = JSON.parse(fs.readFileSync(file, "utf8"));
assert.equal(resolveAccountMatch(registry, { provider: "openai", surface: "chatgpt-desktop", home: path.join(home, "codex"), providerAccountId: "acct-bad" }).reason, "account-identity-mismatch");
assert.equal(resolveAccount(registry, { provider: "openai", surface: "chatgpt-desktop", home: path.join(home, "codex"), providerAccountId: "acct-bad" }), null);
assert.equal(resolveAccountMatch(registry, { provider: "openai", surface: "chatgpt-desktop", home: path.join(home, "codex"), providerAccountId: "acct-good" }).account.slot, "openai-primary");
console.log("account identity guard tests passed");
