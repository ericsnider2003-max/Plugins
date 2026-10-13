// Single source of truth for the model ceiling (Opus 5.5, never fable). Zero dependencies so hooks stay fast.
// Reads family + version from anywhere in the id, so decorated forms count too: "claude-opus-6[1m]", "claude-opus-6-latest",
// Bedrock "us.anthropic.claude-opus-6-v1:0", Vertex "claude-opus-6@20260101", dated "claude-opus-5-5-20260101", and the old "claude-3-5-sonnet-20241022".
// A date (8 digits) is never read as a version; an id whose version cannot be read returns null (callers treat that as "unknown", never "ok").
export function parseModel(model) {
  const name = String(model || "").toLowerCase();
  const fam = name.match(/(opus|sonnet|haiku)/);
  if (!fam) return null;
  const after = name.match(/(?:opus|sonnet|haiku)[-_.]?(\d{1,2})(?:[-.](\d{1,2}))?(?!\d)/);
  const before = after ? null : name.match(/(?:^|[^\d])(\d{1,2})(?:-(\d{1,2}))?-(?:opus|sonnet|haiku)/);
  const m = after || before;
  return { family: fam[1], version: m ? Number(m[1]) + (m[2] ? Number(m[2]) / 10 : 0) : null };
}
export const modelVersion = (model) => { const p = parseModel(model); return p ? p.version : null; };
export function aboveCeiling(model) {
  const name = String(model || "").toLowerCase();
  if (!name) return false;
  if (name.includes("fable")) return true;
  const p = parseModel(name);
  if (!p || p.family !== "opus" || p.version === null) return false; // an alias ("opus") or an id we cannot read is not blocked here; ceilingStatus reports it as unknown
  return p.version > 5.5;
}
