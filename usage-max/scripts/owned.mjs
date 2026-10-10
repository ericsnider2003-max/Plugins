// Settings ownership: usage-max records the value it last wrote per key (applied.json) and from then on changes a key
// only if it is absent or STILL holds that value. A value the user set themselves is kept (and surfaced by doctor).
import { readJson, writeJsonAtomic } from "./meter.mjs";

const J = JSON.stringify;
const get = (o, p) => p.split(".").reduce((x, k) => (x === null || x === undefined ? undefined : x[k]), o);
function put(o, p, v) {
  const ks = p.split("."); let x = o;
  for (const k of ks.slice(0, -1)) { if (typeof x[k] !== "object" || x[k] === null) x[k] = {}; x = x[k]; }
  x[ks[ks.length - 1]] = v;
}

export const loadApplied = (file) => readJson(file, {});
export const saveApplied = (file, applied) => writeJsonAtomic(file, applied);

// "set" (changed), "same" (already that value), or "kept" (the user's own value).
// force=true: the governor is tightening the budget (AMBER/RED), so it may override a user value to save usage.
export function ownedSet(obj, keyPath, value, applied, force = false) {
  const cur = get(obj, keyPath);
  if (J(cur) === J(value)) { applied[keyPath] = value; return "same"; }
  if (force || cur === undefined || (keyPath in applied && J(applied[keyPath]) === J(cur))) { put(obj, keyPath, value); applied[keyPath] = value; return "set"; }
  return "kept";
}
