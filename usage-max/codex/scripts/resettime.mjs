// Reads the "resets at" time a person types for `calibrate --resets`. A wrong value would pin the strict budget mode for a week, so anything
// that cannot be a weekly-reset time is refused with a plain message. Dependency-free; identical copy at codex/scripts/resettime.mjs.
// -> { ms } (epoch milliseconds, possibly with a `note`) or { error }.
export function parseResetTime(input, now = Date.now()) {
  const s = String(input ?? "").trim(); if (!s) return { error: "no reset time given" };
  let ms, note = null;
  if (/^\d+(\.\d+)?$/.test(s)) { const n = Number(s); ms = n > 1e11 ? n : n * 1000; if (n > 1e11) note = "read as milliseconds"; } // seconds (what Claude Code reports) or milliseconds (JavaScript)
  else {
    ms = Date.parse(s); if (!Number.isFinite(ms)) return { error: `could not read "${s}" as a date and time. Use for example 2026-10-17T20:00:00-04:00` };
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) note = "no time zone was given, so it was read as this computer's local time";
  }
  if (!Number.isFinite(ms)) return { error: "that is not a valid time" };
  if (ms <= now) return { error: `${new Date(ms).toISOString()} is already in the past; give the NEXT weekly reset time shown in Settings > Usage` };
  if (ms > now + 8 * 864e5) return { error: `${new Date(ms).toISOString()} is more than 8 days away; the weekly window resets within 7 days` };
  return { ms, ...(note ? { note } : {}) };
}
