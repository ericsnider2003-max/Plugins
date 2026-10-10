// Spend meter: prices assistant turns at list price (proxy for plan usage) and keeps a running total
// plus hourly buckets. Incremental: remembers a byte offset per transcript so each turn is counted once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { priceFor } from "./pricing.mjs";
import { listJsonlFiles } from "./lib.mjs";

export function dataDir() {
  return path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".claude", "usage-max");
}
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

// Cost of one assistant record, honouring the real 5m/1h cache-write split when present.
export function recordCost(message) {
  const p = priceFor(message && message.model);
  const u = (message && message.usage) || {};
  if (!p || message.model === "<synthetic>") return 0;
  const cc = u.cache_creation || {};
  const w5 = Number(cc.ephemeral_5m_input_tokens) || 0;
  const w1 = Number(cc.ephemeral_1h_input_tokens) || 0;
  const created = Number(u.cache_creation_input_tokens) || 0;
  const unsplit = Math.max(created - w5 - w1, 0);
  return ((Number(u.input_tokens) || 0) * p.input + w5 * p.write5m + (w1 + unsplit) * p.write1h +
    (Number(u.cache_read_input_tokens) || 0) * p.read + (Number(u.output_tokens) || 0) * p.output) / 1e6;
}

function hourKey(ms) {
  return new Date(Math.floor(ms / 3600000) * 3600000).toISOString();
}

// Read a transcript from `offset`, return { cost, end, byHour }. Only whole lines are consumed.
export function scanFrom(file, offset = 0, sinceMs = 0) {
  let fd;
  try { fd = fs.openSync(file, "r"); } catch { return { cost: 0, end: offset, byHour: {} }; }
  try {
    const size = fs.fstatSync(fd).size;
    if (size < offset) offset = 0; // truncated/rotated
    const length = size - offset;
    if (length <= 0) return { cost: 0, end: offset, byHour: {} };
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, offset);
    const text = buf.toString("utf8");
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return { cost: 0, end: offset, byHour: {} };
    let cost = 0;
    const byHour = {};
    for (const line of text.slice(0, lastNl).split("\n")) {
      if (!line.includes('"assistant"')) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.type !== "assistant" || !r.message) continue;
      const t = Date.parse(r.timestamp) || Date.now();
      if (t < sinceMs) continue;
      const c = recordCost(r.message);
      if (!c) continue;
      cost += c;
      const h = hourKey(t);
      byHour[h] = (byHour[h] || 0) + c;
    }
    return { cost, end: offset + Buffer.byteLength(text.slice(0, lastNl + 1), "utf8"), byHour };
  } finally {
    fs.closeSync(fd);
  }
}

export function loadMeter() {
  return readJson(path.join(dataDir(), "meter.json"), { cum: 0, offsets: {}, buckets: {}, startedAt: new Date().toISOString() });
}
export function saveMeter(m) {
  const cutoff = Date.now() - 8 * 86400000;
  for (const k of Object.keys(m.buckets)) if (Date.parse(k) < cutoff) delete m.buckets[k];
  writeJsonAtomic(path.join(dataDir(), "meter.json"), m);
}

// Files belonging to one session: the main transcript plus its subagent transcripts.
export function sessionFiles(transcriptPath) {
  if (!transcriptPath) return [];
  const files = [transcriptPath];
  const subDir = path.join(path.dirname(transcriptPath), path.basename(transcriptPath, ".jsonl"), "subagents");
  try { for (const f of fs.readdirSync(subDir)) if (f.endsWith(".jsonl")) files.push(path.join(subDir, f)); } catch {}
  return files;
}

export function meterFiles(m, files) {
  let added = 0;
  for (const f of files) {
    const r = scanFrom(f, m.offsets[f] || 0);
    m.offsets[f] = r.end;
    m.cum += r.cost;
    added += r.cost;
    for (const [h, c] of Object.entries(r.byHour)) m.buckets[h] = (m.buckets[h] || 0) + c;
  }
  return added;
}

export function spendInLast(m, hours, nowMs = Date.now()) {
  const from = nowMs - hours * 3600000;
  let s = 0;
  for (const [h, c] of Object.entries(m.buckets)) if (Date.parse(h) + 3600000 > from) s += c;
  return s;
}

// Full scan used for calibration: spend since `sinceMs`, hourly buckets, and offsets set to EOF.
export async function bootstrap(projectsDir, sinceMs) {
  const m = { cum: 0, offsets: {}, buckets: {}, startedAt: new Date().toISOString() };
  let windowSpend = 0;
  for (const f of await listJsonlFiles(projectsDir)) {
    const r = scanFrom(f, 0, Math.min(sinceMs, Date.now() - 7 * 86400000));
    m.offsets[f] = r.end;
    for (const [h, c] of Object.entries(r.byHour)) {
      m.buckets[h] = (m.buckets[h] || 0) + c;
      if (Date.parse(h) + 3600000 > sinceMs) windowSpend += c;
    }
  }
  return { meter: m, windowSpend };
}
