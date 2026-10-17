#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatHealthReport, healthReport } from "../scripts/health.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-health-")); fs.mkdirSync(path.join(home, ".usage-max"), { recursive: true });
const report = healthReport(home, { now: Date.parse("2026-10-15T08:00:00Z"), activation: { startup: { registered: false }, hooks: { claude: false, codex: false }, nativeHost: { ready: false }, attachmentReceiverConfigured: false } });
assert.equal(report.status, "review"); assert.equal(report.service.running, false); assert.ok(report.unavailable.includes("chatgpt")); assert.match(formatHealthReport(report), /start the observation service/);
const registered = healthReport(home, { now: Date.parse("2026-10-15T08:00:00Z"), activation: { startup: { registered: true }, hooks: { claude: true, codex: true }, nativeHost: { ready: true }, attachmentReceiverConfigured: true } }); assert.match(registered.next[0], /registered for user logon/); assert.equal(registered.activation.attachmentReceiverConfigured, true); assert.equal(registered.activation.nativeHost.ready, true);
console.log("health report tests passed");
