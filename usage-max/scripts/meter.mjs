// Spend meter: prices assistant turns at list price (proxy for plan usage) and keeps a running total
// plus hourly buckets. Incremental: remembers a byte offset per transcript so each turn is counted once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordCost, takeUnknownModels } from "./pricing.mjs";
import { listJsonlFiles } from "./lib.mjs";
import { withLock, canonPath } from "./safefile.mjs";

export function dataDir() {
  return path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".claude", "usage-max");
}
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
export function writeJsonAtomic(file, value) {
  let target = file, mode = null;
  try { target = fs.realpathSync(file); mode = fs.statSync(target).mode & 0o777; } catch {} // follow symlinks (stow/chezmoi), keep the file mode
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  if (mode !== null) { try { fs.chmodSync(tmp, mode); } catch {} }
  fs.renameSync(tmp, target);
}

export { recordCost };

function hourKey(ms) {
  return new Date(Math.floor(ms / 3600000) * 3600000).toISOString();
}
const minKey = (ms) => new Date(Math.floor(ms / 60000) * 60000).toISOString();
// Spend is kept per MINUTE for the last day (m.fine) and per hour before that (m.buckets): "how much was spent since the plan reading at 12:05" is
// then exact to a minute, instead of guessing a share of the whole hour (which counted a burst just before a reading as spent after it).
export const fineCut = (nowMs) => Math.floor((nowMs - 24 * 3600000) / 3600000) * 3600000;
function addSpend(m, tMs, c, nowMs) {
  if (tMs >= fineCut(nowMs)) { m.fine = m.fine || {}; const k = minKey(tMs); m.fine[k] = (m.fine[k] || 0) + c; }
  else { const k = hourKey(tMs); m.buckets[k] = (m.buckets[k] || 0) + c; }
}
function compact(m, nowMs) { // minutes that fell out of the last-day window are folded into their hour
  const cut = fineCut(nowMs);
  for (const [k, c] of Object.entries(m.fine || {})) { const t = Date.parse(k); if (t < cut) { const h = hourKey(t); m.buckets[h] = (m.buckets[h] || 0) + c; delete m.fine[k]; } }
}

// Read a transcript from `offset`, return { cost, end, byHour, byMin }. Only whole lines are consumed. The file is read in chunks (a transcript can be gigabytes;
// reading what is left of it in one piece ran out of memory), carrying a partial last line into the next chunk.
export function scanFrom(file, offset = 0, sinceMs = 0, seen = new Set(), chunkBytes = 8 * 1024 * 1024) {
  let fd;
  try { fd = fs.openSync(file, "r"); } catch { return { cost: 0, end: offset, byHour: {}, byMin: {} }; }
  try {
    const size = fs.fstatSync(fd).size;
    if (size < offset) offset = 0; // truncated/rotated
    let cost = 0, end = offset, pos = offset, carry = Buffer.alloc(0);
    const byHour = {}, byMin = {};
    const take = (line) => {
      if (!line.includes('"assistant"')) return;
      let r; try { r = JSON.parse(line); } catch { return; }
      if (r.type !== "assistant" || !r.message) return;
      const mid = r.message.id; // one record per content block repeats the same usage: count each message once
      if (mid) { if (seen.has(mid)) return; seen.add(mid); }
      const t = Date.parse(r.timestamp) || Date.now();
      if (t < sinceMs) return;
      const c = recordCost(r.message);
      if (!c) return;
      cost += c;
      const h = hourKey(t); byHour[h] = (byHour[h] || 0) + c;
      const mk = minKey(t); byMin[mk] = (byMin[mk] || 0) + c;
    };
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(chunkBytes, size - pos)); const got = fs.readSync(fd, buf, 0, buf.length, pos); if (got <= 0) break; pos += got;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, got)]) : buf.subarray(0, got), nl = data.lastIndexOf(10);
      if (nl < 0) { carry = data; continue; }
      for (const line of data.subarray(0, nl).toString("utf8").split("\n")) take(line);
      end += nl + 1; carry = data.subarray(nl + 1);
    }
    return { cost, end, byHour, byMin };
  } finally {
    fs.closeSync(fd);
  }
}

export function loadMeter() {
  return readJson(path.join(dataDir(), "meter.json"), { cum: 0, offsets: {}, buckets: {}, fine: {}, startedAt: new Date().toISOString() });
}
export const writeFailures = [];
export function saveMeter(m) {
  const cutoff = Date.now() - 8 * 86400000; compact(m, Date.now());
  for (const k of Object.keys(m.buckets)) if (Date.parse(k) < cutoff) delete m.buckets[k];
  const keys = Object.keys(m.offsets || {}); if (keys.length > 200) for (const k of keys) { try { fs.statSync(k); } catch { delete m.offsets[k]; } } // offsets of deleted transcripts would grow forever
  try { writeJsonAtomic(path.join(dataDir(), "meter.json"), m); } catch (e) { writeFailures.push(`meter.json: ${e.code || e.message}`); }
}

// Files belonging to one session: the main transcript plus its subagent transcripts.
export function sessionFiles(transcriptPath) {
  if (!transcriptPath) return [];
  const files = [transcriptPath];
  const subDir = path.join(path.dirname(transcriptPath), path.basename(transcriptPath, ".jsonl"), "subagents");
  try { for (const f of fs.readdirSync(subDir)) if (f.endsWith(".jsonl")) files.push(path.join(subDir, f)); } catch {}
  return files;
}

// Load -> scan -> save as one step that no other session can interleave with (two Stop hooks at once used to lose or double count turns).
// -> the added cost, or null when another process held the lock for too long (the next hook catches up from the saved offsets).
export function updateMeter(files) {
  const r = withLock(path.join(dataDir(), "meter.json"), () => { const m = loadMeter(); const added = meterFiles(m, files); saveMeter(m); return { m, added }; });
  return r.ok ? r.value : null;
}
export function meterFiles(m, files) {
  let added = 0;
  const seen = new Set(m.recentIds || []);
  for (const f of files) {
    const key = canonPath(f); // one entry per file however the path is spelled (case, slashes, links)
    const r = scanFrom(f, m.offsets[key] ?? m.offsets[f] ?? 0, Date.now() - 8 * 86400000, seen);
    delete m.offsets[f]; m.offsets[key] = r.end;
    m.cum += r.cost;
    added += r.cost;
    const now = Date.now(); for (const [k, c] of Object.entries(r.byMin)) addSpend(m, Date.parse(k), c, now);
  }
  m.recentIds = [...seen].slice(-3000);
  const unk = takeUnknownModels(); if (unk.length) m.unknownModels = [...new Set([...(m.unknownModels || []), ...unk])].slice(-20); // priced like the nearest family; doctor lists them
  return added;
}

export function spendInLast(m, hours, nowMs = Date.now()) {
  const from = nowMs - hours * 3600000;
  let s = 0;
  for (const [k, c] of Object.entries(m.fine || {})) { const st = Date.parse(k); if (st + 60000 > from) s += c * Math.min(1, (st + 60000 - from) / 60000); } // exact to the minute
  for (const [h, c] of Object.entries(m.buckets || {})) { const st = Date.parse(h); if (st + 3600000 > from) s += c * Math.min(1, (st + 3600000 - from) / 3600000); } // older hours: the one straddling `from` counts its later share
  return s;
}

// Full scan used for calibration: spend since `sinceMs`, hourly buckets, and offsets set to EOF.
export async function bootstrap(projectsDir, sinceMs) {
  const m = { cum: 0, offsets: {}, buckets: {}, fine: {}, startedAt: new Date().toISOString() };
  let windowSpend = 0; const seen = new Set(); // one seen-set for the whole scan: a message that appears in two transcript files is priced once
  const now = Date.now();
  for (const f of await listJsonlFiles(projectsDir)) {
    const r = scanFrom(f, 0, Math.min(sinceMs, now - 7 * 86400000), seen);
    m.offsets[canonPath(f)] = r.end;
    for (const [k, c] of Object.entries(r.byMin)) {
      const t = Date.parse(k); addSpend(m, t, c, now);
      if (t + 60000 > sinceMs) windowSpend += c * Math.min(1, (t + 60000 - sinceMs) / 60000);
    }
  }
  return { meter: m, windowSpend };
}
