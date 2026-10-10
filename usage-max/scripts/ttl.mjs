// Pick the prompt-cache lifetime from the user's own sessions: replay every main-loop session with its real gaps
// under a 5-minute cache and compare with what was actually paid (1h writes). Pure + small so profile.mjs can use it.
import fs from "node:fs";
import { listJsonlFiles, normalizeUsage, parseTimestamp } from "./lib.mjs";
import { priceFor, replayTtl } from "./pricing.mjs";

export async function ttlAdvice(projectsDir, { days = 14, minSessions = 5, nowMs = Date.now(), margin = 0.03 } = {}) {
  const since = nowMs - days * 86400000;
  let actual = 0, sim5m = 0, sessions = 0;
  for (const file of await listJsonlFiles(projectsDir)) {
    if (file.includes("/subagents/") || file.includes("\\subagents\\")) continue;
    const seen = new Set(), turns = [];
    let text = ""; try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.includes('"assistant"')) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.type !== "assistant" || !r.message || !r.message.model || r.message.model === "<synthetic>" || r.isSidechain === true) continue;
      if (r.message.id) { if (seen.has(r.message.id)) continue; seen.add(r.message.id); }
      const t = parseTimestamp(r.timestamp); if (t && t < since) continue;
      const u = normalizeUsage(r.message.usage);
      turns.push({ t, u, p: priceFor(r.message.model, u.input + u.created + u.read) });
    }
    if (turns.length < 3) continue;
    turns.sort((a, b) => a.t - b.t);
    const rep = replayTtl(turns); actual += rep.actual; sim5m += rep.sim5m; sessions += 1;
  }
  const enough = sessions >= minSessions && actual > 0;
  const recommend = !enough ? null : sim5m < actual * (1 - margin) ? "5m" : "1h";
  return { sessions, actual, sim5m, savedByFiveMin: actual - sim5m, recommend };
}
