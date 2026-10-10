// Cross-plan status shared by the Claude and Codex governors: ~/.usage-max/shared.json = { claude: {...}, codex: {...} }.
// Each side writes only its own key, so either plan can see when the other has headroom and shift work to it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = () => path.join(process.env.USAGE_MAX_HOME || os.homedir(), ".usage-max", "shared.json");
const read = () => { try { return JSON.parse(fs.readFileSync(file(), "utf8")); } catch { return {}; } };

export function writeSelf(self, entry) {
  try {
    const all = read();
    all[self] = { ...entry, updatedAt: entry.updatedAt || new Date().toISOString() };
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, file());
  } catch {}
}
export const readOther = (other) => read()[other] || null;
export const isFresh = (entry, now = Date.now(), maxAgeMs = 6 * 3600e3) => Boolean(entry && Date.now && now - Date.parse(entry.updatedAt) < maxAgeMs && now >= Date.parse(entry.updatedAt) - 60000);

// Pure. self/other are shared entries; names are for the message only.
export function balanceAdvice(self, other, now = Date.now(), { selfName = "Claude", otherName = "Codex", dispatch = "" } = {}) {
  if (!self || !other || !isFresh(other, now)) return null;
  if ((self.mode === "amber" || self.mode === "red") && other.mode === "green") {
    return `usage-max balance: ${otherName} has headroom (week ~${Math.round(other.estPct ?? 0)}% used, ${other.surplus ? "surplus" : "GREEN"}) while your ${selfName} plan is ${self.mode.toUpperCase()}. Shift large implementation/review work to ${otherName}${dispatch}.`;
  }
  return null;
}
