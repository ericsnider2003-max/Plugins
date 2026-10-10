// Things that keep spending your plan while you are away: scheduled jobs and long-running claude/codex processes.
// Report only (nothing is stopped); `usage-max rescue halt` prints the stop steps. Best effort: every probe is time-limited and optional.
import { spawnSync } from "node:child_process";

const MINE = /usage-max|background\.mjs/;
const WATCH = /\b(claude|codex)\b/i;
export const parseCron = (text) => String(text || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && WATCH.test(l) && !MINE.test(l)).map((l) => ({ kind: "cron", text: l.slice(0, 160) }));
export function parseSchtasks(csv) {
  const out = [];
  for (const line of String(csv || "").split(/\r?\n/)) {
    if (!/claude|codex/i.test(line) || MINE.test(line)) continue;
    const cells = line.split('","').map((c) => c.replace(/^"|"$/g, "")); // /fo csv /v: first cell is the host, second the task name
    out.push({ kind: "schtask", text: (cells[1] || line).slice(0, 160) });
  }
  return out;
}
// ps -eo pid,etime,args  ->  headless runs (claude -p / codex exec) and loops; interactive sessions are not flagged
export function parsePs(text, selfPid = process.pid) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/); if (!m || Number(m[1]) === selfPid) continue;
    const args = m[3]; if (MINE.test(args) || !WATCH.test(args)) continue;
    if (/^(?:\S*[\\/])?claude(?:\.\w+)?(?:\s.*)?\s(?:-p|--print)\b/.test(args) || /^(?:\S*[\\/])?codex(?:\.\w+)?\s+exec\b/.test(args)) out.push({ kind: "process", text: `pid ${m[1]} running ${m[2]}: ${args.slice(0, 120)}` });
  }
  return out;
}
const sh = (cmd, args) => { try { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 4000 }); return r.status === 0 ? r.stdout : ""; } catch { return ""; } };
export function findBackground() {
  if (process.platform === "win32") {
    return [...parseSchtasks(sh("schtasks", ["/query", "/fo", "csv", "/v"])),
      ...parsePs(sh("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) 00:00 $($_.CommandLine)\" }"]))];
  }
  return [...parseCron(sh("crontab", ["-l"])), ...parsePs(sh("ps", ["-eo", "pid,etime,args"]))];
}
