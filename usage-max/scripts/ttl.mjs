// Pick the prompt-cache lifetime from the user's own sessions: replay every main-loop session with its real gaps
// under a 5-minute cache and compare with what was actually paid (1h writes). Pure + small so profile.mjs can use it.
import fs from "node:fs";
import { listJsonlFiles, normalizeUsage, parseTimestamp, createDeduper } from "./lib.mjs";
import { priceFor, replayTtl } from "./pricing.mjs";

export async function ttlAdvice(projectsDir, { days = 14, minSessions = 5, nowMs = Date.now(), margin = 0.03, budgetMs = 3000 } = {}) {
  const deadline = Date.now() + budgetMs; // hooks have a hard timeout: report what we have rather than risk it
  const since = nowMs - days * 86400000;
  let actual = 0, sim5m = 0, sessions = 0;
  const files = (await listJsonlFiles(projectsDir)).map((f) => { try { return { f, m: fs.statSync(f).mtimeMs }; } catch { return null; } }).filter((x) => x && x.m >= since).sort((a, b) => b.m - a.m).map((x) => x.f); // newest first, only the window
  const dedupe = createDeduper(); // a resumed session that repeats earlier turns must not count them twice; the largest-output copy wins
  for (const file of files) {
    if (Date.now() > deadline) break;
    if (file.includes("/subagents/") || file.includes("\\subagents\\")) continue;
    let text = ""; try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.includes('"assistant"')) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.type !== "assistant" || !r.message || !r.message.model || r.message.model === "<synthetic>" || r.isSidechain === true) continue;
      dedupe.add(r.message, { file, t: parseTimestamp(r.timestamp), message: r.message });
    }
  }
  const byFile = new Map();
  for (const it of dedupe.items()) {
    if (it.t && it.t < since) continue;
    const u = normalizeUsage(it.message.usage);
    if (!byFile.has(it.file)) byFile.set(it.file, []);
    byFile.get(it.file).push({ t: it.t, u, p: priceFor(it.message.model, u.input + u.created + u.read) });
  }
  for (const turns of byFile.values()) {
    if (turns.length < 3) continue;
    turns.sort((a, b) => a.t - b.t);
    const rep = replayTtl(turns); actual += rep.actual; sim5m += rep.sim5m; sessions += 1;
  }
  const enough = sessions >= minSessions && actual > 0;
  const recommend = !enough ? null : sim5m < actual * (1 - margin) ? "5m" : "1h";
  return { sessions, actual, sim5m, savedByFiveMin: actual - sim5m, recommend };
}
