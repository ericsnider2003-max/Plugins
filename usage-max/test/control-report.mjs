#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { controlReport, formatControlReport } from "../scripts/control-report.mjs";
import { registerAccount, setAccountApproval } from "../scripts/accounts.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-report-")); fs.mkdirSync(path.join(home, ".usage-max"), { recursive: true });
const report = controlReport(home); assert.equal(report.tasks.total, 0); assert.equal(report.trials.active, 0); assert.equal(report.accountActivity.snapshots, 0); assert.equal(report.collector.events, 0); assert.match(formatControlReport(report), /account activity:/); assert.match(formatControlReport(report), /collectors:/); assert.match(formatControlReport(report), /current models:/); assert.match(formatControlReport(report), /coverage:/); assert.equal(report.surfaces.length >= 8, true);
const attachedHome = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-report-attached-")); const attachedData = path.join(attachedHome, ".usage-max"); fs.mkdirSync(path.join(attachedData, "attachments"), { recursive: true }); const accounts = path.join(attachedData, "accounts.json"); registerAccount(accounts, { slot: "chatgpt-slot", provider: "openai", surfaces: ["chatgpt"], home: attachedHome }); setAccountApproval(accounts, "chatgpt-slot", { approved: true }); fs.writeFileSync(path.join(attachedData, "attachments", "chatgpt.json"), JSON.stringify({ surface: "chatgpt", capture: { source: "supported-attachment", model: "gpt-4o" } })); const attachedReport = controlReport(attachedHome); assert.equal(attachedReport.surfaces.find((x) => x.surface === "chatgpt").observation, "supplemental"); assert.equal(attachedReport.surfaces.find((x) => x.surface === "chatgpt").notification, "unavailable");
console.log("control report tests passed");
