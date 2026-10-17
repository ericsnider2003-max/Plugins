import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendObservation } from "../scripts/observation-ledger.mjs";
import { tick } from "../scripts/worker-service.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-auto-account-notice-")); const data = path.join(home, ".usage-max"); fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(path.join(data, "accounts.json"), JSON.stringify({ contract: "usage-max.account-registry.v1", version: 1, accounts: [{ contract: "usage-max.account-slot.v1", slot: "codex-unapproved", provider: "openai", surfaces: ["codex-cli"], approved: false, enabled: false, routingEnabled: true }] }));
appendObservation(path.join(data, "observations.jsonl"), { contract: "usage-max.observation.v1", observationId: "auto-approval-observation", provider: "openai", surface: "codex-cli", source: "fixture", account: { slot: "codex-unapproved", approved: false }, capturedAt: "2026-10-15T08:00:00Z", authority: "provider", state: "observing", freshness: "fresh", confidence: "measured", window: { id: "weekly", usedPercentage: 4 }, model: { known: true }, data: {} });
await tick({ home, now: Date.parse("2026-10-15T08:01:00Z"), capture: false }); await tick({ home, now: Date.parse("2026-10-15T08:02:00Z"), capture: false });
const notices = fs.readFileSync(path.join(data, "notifications.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse); assert.equal(notices.filter((x) => x.noticeId === "account-approval-codex-unapproved").length, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(data, "accounts.json"), "utf8")).accounts[0].approved, false);
console.log("automatic account approval notice tests passed");
