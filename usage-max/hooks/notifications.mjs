#!/usr/bin/env node
// Claude Code notification bridge. It only delivers local, already-generated
// notices through the supported UserPromptSubmit hook; it never sends network
// messages or changes provider state.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const home = process.env.USAGE_MAX_HOME || os.homedir(); const file = path.join(home, ".usage-max", "notifications.jsonl");
try {
  if (!fs.existsSync(file)) process.exit(0);
  const notices = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
  const pending = notices.filter((x) => !x.deliveredAt).slice(0, 5);
  if (!pending.length) process.exit(0);
  const now = new Date().toISOString(); const ids = new Set(pending.map((x) => x.noticeId));
  const updated = notices.map((x) => ids.has(x.noticeId) ? { ...x, deliveredAt: now, deliveredSurface: "claude-code" } : x);
  fs.writeFileSync(file, `${updated.map((x) => JSON.stringify(x)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  const text = pending.map((x) => `usage-max ${x.kind}: ${x.message}`).join("\n");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text }, systemMessage: `usage-max delivered ${pending.length} pending notification${pending.length === 1 ? "" : "s"}.` }));
} catch { /* notification failure never blocks the user's work */ }
