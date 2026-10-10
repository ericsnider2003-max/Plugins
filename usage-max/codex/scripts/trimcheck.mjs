// Codex-side trim self-test: same idea as scripts/trimtest.mjs (kept self-contained so the stable Codex copy needs nothing from the Claude side).
// A trimmed command that is run again within 3 minutes means the cut output was needed; above 30% after 10 samples, trim switches itself off.
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const f = (dir) => path.join(dir, "trimcheck.json");
const load = (dir) => { try { return JSON.parse(fs.readFileSync(f(dir), "utf8")); } catch { return { rewrites: 0, retries: 0, recent: {}, disabled: false, reason: null }; } };
const save = (dir, s) => { try { fs.mkdirSync(dir, { recursive: true }); const t = f(dir) + "." + process.pid + ".tmp"; fs.writeFileSync(t, JSON.stringify(s)); fs.renameSync(t, f(dir)); } catch {} };
export const isDisabled = (dir) => load(dir).disabled === true;
export function record(dir, cmd, now = Date.now()) {
  const s = load(dir), h = crypto.createHash("sha1").update(String(cmd)).digest("hex").slice(0, 12);
  for (const k of Object.keys(s.recent || {})) if (now - s.recent[k] > 180e3) delete s.recent[k];
  const retry = h in s.recent; s.rewrites++; if (retry) s.retries++; s.recent[h] = now;
  if (!s.disabled && s.rewrites >= 10 && s.retries / s.rewrites > 0.3) { s.disabled = true; s.reason = `${s.retries} of ${s.rewrites} trimmed commands were re-run within 3 minutes`; }
  save(dir, s); return { retry, disabled: s.disabled };
}
export const setEnabled = (dir, on) => { const s = load(dir); s.disabled = !on; s.reason = on ? null : "turned off by you"; if (on) { s.rewrites = 0; s.retries = 0; } save(dir, s); };
export const summary = (dir) => { const s = load(dir); return s.rewrites ? { rewrites: s.rewrites, retries: s.retries, disabled: s.disabled, reason: s.reason } : null; };
