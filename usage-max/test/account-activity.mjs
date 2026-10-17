import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAccountActivity, summarizeAccountActivity, appendAccountActivity, readAccountActivity, activityLedgerFile } from "../scripts/account-activity.mjs";
const snapshot = normalizeAccountActivity({ activities: [{ id: "a-1", timestamp: "2026-10-15T08:00:00Z", model_id: "gpt-4o", tokens: 100, requests: 1, session_id: "s1" }, { id: "a-2", timestamp: "2026-10-15T08:01:00Z", tokens: 50, requests: 1 }] }, { provider: "openai", account: "redacted-account", capturedAt: "2026-10-15T08:02:00Z" });
assert.equal(snapshot.activity.length, 2); assert.equal(snapshot.activity[0].attributed, true); assert.equal(snapshot.activity[1].attributed, false); assert.equal(summarizeAccountActivity(snapshot, { localTokens: 100 }).unattributedDelta, 50);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-max-activity-")); const file = activityLedgerFile(home); assert.equal(appendAccountActivity(file, snapshot).appended, true); assert.equal(appendAccountActivity(file, snapshot).duplicate, true); assert.equal(readAccountActivity(file).length, 1);
console.log("account activity tests passed");
