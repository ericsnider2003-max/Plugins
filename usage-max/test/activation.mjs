#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { activationStatus, formatActivationStatus } from "../scripts/activation.mjs";
import { startupPlan } from "../scripts/activation-install.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-activation-")); const root = process.cwd(); const report = activationStatus(home, root); assert.equal(report.mode, "observation-only"); assert.equal(report.hooks.claude, true); assert.equal(report.hooks.codex, true); assert.equal(report.browserAdapter, true); assert.equal(report.nativeHost.ready, false); assert.equal(report.nativeHost.manifest, false); assert.equal(report.desktopExtension.ready, true); assert.equal(report.mcpHttp.available, true); assert.equal(report.mcpHttp.tunnelRequiredForChatGPT, true); assert.match(report.desktopExtension.install, /mcpb build/); assert.equal(report.service.running, false); assert.match(formatActivationStatus(report), /browser native bootstrap: not registered/); assert.match(formatActivationStatus(report), /desktop MCPB: available/); assert.match(formatActivationStatus(report), /HTTP MCP bridge: available/);
const plan = startupPlan({ root, home, nodePath: "C:/Node/node.exe", platform: "win32" }); assert.equal(plan.createArgs[0], "/Create"); assert.match(plan.command, /host-runtime\.mjs.*run/); assert.match(plan.safety, /observation-only/); assert.equal(plan.createArgs.at(-1), "/F");
assert.equal(plan.registryKey, "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"); assert.ok(plan.registryAddArgs.includes("/f"));
const running = activationStatus(home, root, { processes: { providers: { chatgpt: { running: true }, cowork: { running: true } } } }); assert.match(running.next.join("; "), /ChatGPT process detected/); assert.match(running.next.join("; "), /Cowork process detected/);
console.log("activation status tests passed");
