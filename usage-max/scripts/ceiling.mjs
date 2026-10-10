// Single source of truth for the model ceiling (Opus 5.5, never fable). Zero dependencies so hooks stay fast.
export function aboveCeiling(model) {
  const name = String(model || "").toLowerCase();
  if (!name) return false;
  if (name.includes("fable")) return true;
  const m = name.match(/opus-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  if (!m) return false;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 10 : 0) > 5.5;
}
