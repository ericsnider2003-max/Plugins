#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerAccount, setAccountApproval } from "../scripts/accounts.mjs";
import { ingestAttachments } from "../scripts/attachments.mjs";
import { readLedger } from "../scripts/observation-ledger.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-producer-attestation-")); const data = path.join(home, ".usage-max"); fs.mkdirSync(path.join(data, "attachments"), { recursive: true });
const accounts = path.join(data, "accounts.json"); registerAccount(accounts, { slot: "chatgpt-desktop", provider: "openai", surfaces: ["chatgpt-desktop"], home }); setAccountApproval(accounts, "chatgpt-desktop", { approved: true });
const capture = { source: "openai-webmcp", capturedAt: "2026-10-15T08:00:00Z", model: "gpt-5.6-luna", rate_limits: { weekly: { used_percentage: 43 } } };
fs.writeFileSync(path.join(data, "attachments", "chatgpt-desktop.json"), JSON.stringify({ surface: "chatgpt-desktop", producer: "browser-extension", capture }));
assert.equal(ingestAttachments(home, { now: Date.parse("2026-10-15T08:01:00Z") })[0].accepted, true); let rows = readLedger(path.join(data, "observations.jsonl")); assert.equal(rows[0].authority, "provider"); assert.equal(rows[0].state, "governing");
fs.writeFileSync(path.join(data, "attachments", "chatgpt-desktop.json"), JSON.stringify({ surface: "chatgpt-desktop", capture }));
fs.rmSync(path.join(data, "observations.jsonl"), { force: true }); assert.equal(ingestAttachments(home, { now: Date.parse("2026-10-15T08:01:00Z") })[0].accepted, true); rows = readLedger(path.join(data, "observations.jsonl")); assert.equal(rows[0].authority, "unattributed"); assert.equal(rows[0].state, "observing");
console.log("producer attestation tests passed");
