// Cross-plan status shared with the Claude side: ~/.usage-max/shared.json { claude: {...}, codex: {...} }. Each side writes only its own key. Never throws.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
export const sharedFile = () => path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".usage-max", "shared.json");
const rd = () => { try { const o = JSON.parse(fs.readFileSync(sharedFile(), "utf8")); return o && typeof o === "object" ? o : {}; } catch { return {}; } };
export function writeSelf(entry) { try { const f = sharedFile(), o = rd(); o.codex = entry; fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + "." + process.pid + ".tmp"; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, f); } catch {} }
export const readOther = () => rd().claude || null;
export const isFresh = (e, now = Date.now(), maxAgeMs = 6 * 3600e3) => { const t = e && Date.parse(e.updatedAt); return !!t && now - t >= 0 && now - t <= maxAgeMs; };
export function balanceAdvice(self, other, now = Date.now()) {
  if (!self || !other || !isFresh(other, now)) return null;
  if ((self.mode === "amber" || self.mode === "red") && other.mode === "green") return `usage-max balance: Claude has headroom (week ~${Math.round(other.estPct)}% used, ${other.surplus ? "surplus" : "GREEN"}). Tell the user it can take the large implementation/review work instead of Codex (your plan is ${self.mode.toUpperCase()}).`;
  return null;
}
