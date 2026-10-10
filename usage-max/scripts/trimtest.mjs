// Trim self-test. Output trimming is contested (vendor claims 60-90%; an independent A/B reported no saving), so usage-max measures its own:
//   measured: how many bytes the trim removed, and how often the SAME command was run again within 3 minutes of a trim
//   (a retry means the model needed the output we cut, so the trim cost a turn). Too many retries switch trim off by itself.
import path from "node:path"; import crypto from "node:crypto";
import { readJson, writeJsonAtomic } from "./meter.mjs";
const file = (dir) => path.join(dir, "trimtest.json");
const blank = () => ({ rewrites: 0, retries: 0, raw: 0, out: 0, recent: {}, disabled: false, reason: null, since: new Date().toISOString() });
export const load = (dir) => ({ ...blank(), ...(readJson(file(dir), null) || {}) });
const save = (dir, s) => { try { writeJsonAtomic(file(dir), s); } catch {} };
export const MIN_SAMPLE = 10, MAX_RETRY_RATE = 0.3, RETRY_MS = 180e3;
export const isDisabled = (dir) => load(dir).disabled === true;
export function recordRewrite(dir, cmd, now = Date.now()) {
  const s = load(dir), h = crypto.createHash("sha1").update(String(cmd)).digest("hex").slice(0, 12);
  for (const k of Object.keys(s.recent)) if (now - s.recent[k] > RETRY_MS) delete s.recent[k];
  const retry = h in s.recent; s.rewrites++; if (retry) s.retries++; s.recent[h] = now;
  if (!s.disabled && s.rewrites >= MIN_SAMPLE && s.retries / s.rewrites > MAX_RETRY_RATE) { s.disabled = true; s.reason = `${s.retries} of ${s.rewrites} trimmed commands were re-run within 3 minutes, so the cut output was being needed`; }
  save(dir, s); return { retry, disabled: s.disabled };
}
export function recordBytes(dir, raw, out) { const s = load(dir); s.raw += raw; s.out += out; save(dir, s); }
export function setEnabled(dir, on) { const s = load(dir); s.disabled = !on; s.reason = on ? null : "turned off by you"; if (on) { s.rewrites = 0; s.retries = 0; } save(dir, s); }
export function report(dir) {
  const s = load(dir);
  if (!s.rewrites) return "trim: no trimmed commands recorded yet (it only touches noisy install/test/build commands).";
  const rate = s.retries / s.rewrites, removed = Math.max(0, s.raw - s.out);
  const L = [`measured  ${s.rewrites} trimmed commands since ${s.since.slice(0, 10)}; ${removed.toLocaleString("en-US")} bytes removed (${s.raw ? Math.round(100 * removed / s.raw) : 0}% of the output)`,
    `measured  ${s.retries} re-run within 3 min (${Math.round(100 * rate)}%); trim switches itself off above ${MAX_RETRY_RATE * 100}% once it has ${MIN_SAMPLE} samples`,
    `estimate  ~${Math.round(removed / 4).toLocaleString("en-US")} tokens kept out of context once (more if the output would have stayed in a long session; cache reads make the real saving smaller)`];
  L.push(s.disabled ? `status    OFF: ${s.reason}. Turn back on with: usage-max trim on` : rate > 0.15 ? "status    ON, but retries are high; watch it." : "status    ON and not causing re-runs so far.");
  return L.join("\n");
}
