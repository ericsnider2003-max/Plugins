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

// Remove a key only if it still holds the value usage-max wrote (the user's own value is never removed). Returns true when removed.
// When usage-max FORCES a value over one the user set (tightening), the user's value is remembered under applied.__prev and handed back
// (instead of deleted or replaced by our own default) when the key is released.
const PREV = "__prev";
const prevOf = (applied, k) => applied[PREV] && k in applied[PREV] ? applied[PREV] : null;
const dropPrev = (applied, k) => { if (applied[PREV]) { delete applied[PREV][k]; if (!Object.keys(applied[PREV]).length) delete applied[PREV]; } };
export function ownedRestore(obj, keyPath, applied) {
  const pv = prevOf(applied, keyPath); if (!pv) return false;
  const cur = get(obj, keyPath), ours = keyPath in applied && J(cur) === J(applied[keyPath]), user = pv[keyPath];
  delete applied[keyPath]; dropPrev(applied, keyPath);
  if (!ours) return false; // the user changed it again since: it is theirs now
  put(obj, keyPath, user); return true;
}
export function ownedUnset(obj, keyPath, applied) {
  if (!(keyPath in applied)) return false;
  if (prevOf(applied, keyPath)) return ownedRestore(obj, keyPath, applied);
  const cur = get(obj, keyPath), ours = J(cur) === J(applied[keyPath]); delete applied[keyPath];
  if (!ours || cur === undefined) return false;
  const ks = keyPath.split("."), last = ks.pop(), parent = ks.reduce((x, k) => (x ? x[k] : undefined), obj);
  if (parent) { delete parent[last]; if (ks.length && Object.keys(parent).length === 0) { const gp = ks.slice(0, -1).reduce((x, k) => x[k], obj); delete gp[ks[ks.length - 1]]; } }
  return true;
}
export const loadApplied = (file) => readJson(file, {});
export const saveApplied = (file, applied) => writeJsonAtomic(file, applied);

// "set" (changed), "same" (already that value), or "kept" (the user's own value).
// force=true: the governor is tightening the budget (AMBER/RED), so it may override a user value to save usage.
export function ownedSet(obj, keyPath, value, applied, force = false) {
  const cur = get(obj, keyPath);
  if (J(cur) === J(value)) { if (keyPath in applied) applied[keyPath] = value; return "same"; } // already that value: only ours if we wrote it before; a user's own identical value is never claimed (so it can never be "handed back" = deleted)
  const ours = keyPath in applied && J(applied[keyPath]) === J(cur);
  if (force || cur === undefined || ours) {
    if (force && cur !== undefined && !ours) applied[PREV] = { ...(applied[PREV] || {}), [keyPath]: cur }; // remember what the user had
    put(obj, keyPath, value); applied[keyPath] = value; return "set";
  }
  return "kept";
}
