import fs from "node:fs";
import path from "node:path";
export function workflowLedgerFile(home) { return path.join(home, ".usage-max", "workflows.jsonl"); }
export function appendWorkflow(home, record) { if (!record?.workflowId) throw new Error("workflowId is required"); const file = workflowLedgerFile(home); fs.mkdirSync(path.dirname(file), { recursive: true }); const rows = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean) : []; if (rows.some((x) => { try { return JSON.parse(x).eventId === record.eventId; } catch { return false; } })) return { duplicate: true, record }; fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 }); return { duplicate: false, record }; }
export function readWorkflows(home) { const file = workflowLedgerFile(home); if (!fs.existsSync(file)) return []; return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
