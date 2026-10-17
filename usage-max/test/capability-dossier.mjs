#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { capabilityDossier, formatCapabilityDossier } from "../scripts/capability-dossier.mjs";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-dossier-"));
const report = capabilityDossier(home, { now: Date.parse("2026-10-15T08:00:00Z") });
assert.equal(report.mode, "observation-only"); assert.equal(report.enforcementEnabled, false); assert.ok(report.surfaces.some((x) => x.surface === "chatgpt")); assert.ok(report.surfaces.some((x) => x.surface === "chatgpt" && /structured provider producer|HTTP MCP/.test(x.remedy))); assert.match(formatCapabilityDossier(report), /enforcement: disabled/);
console.log("capability dossier tests passed");
