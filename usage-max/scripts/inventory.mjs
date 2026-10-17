#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { listJsonlFiles, scanAssistantRecords } from "./lib.mjs";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) return fallback;
  return next;
}

function homeDir() {
  return process.env.USAGE_MAX_HOME || os.homedir();
}

function runCommand(file, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error: error ? String(error.message).slice(0, 300) : null, stdout: String(stdout || ""), stderr: String(stderr || "").slice(0, 500) });
    });
  });
}

async function scheduledTasks() {
  if (process.platform === "win32") {
    const result = await runCommand("schtasks", ["/query", "/fo", "CSV"]);
    if (result.error) return { method: "schtasks /query /fo CSV", error: result.error, matches: [] };
    const matches = result.stdout.split(/\r?\n/).filter((line) => line.toLowerCase().includes("claude")).slice(0, 50);
    return { method: "schtasks /query /fo CSV", matches, limitation: "Only OS-level Task Scheduler rows; Desktop Routines and in-session /loop jobs must be checked in their own UIs." };
  }
  const result = await runCommand("crontab", ["-l"]);
  if (result.error) return { method: "crontab -l", error: result.error, matches: [] };
  const matches = result.stdout.split(/\n/).filter((line) => line.toLowerCase().includes("claude")).slice(0, 50);
  return { method: "crontab -l", matches, limitation: "Only user crontab; Desktop Routines and in-session /loop jobs must be checked in their own UIs." };
}

async function loopMentions(projectsDir, recentDays) {
  const cutoff = Date.now() - Number(recentDays) * 86400000;
  const files = (await listJsonlFiles(projectsDir))
    .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .filter((entry) => entry.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 100)
    .map((entry) => entry.file);
  const hits = [];
  for (const file of files) {
    const stream = fs.createReadStream(file, { encoding: "utf8" });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line || !line.includes("/loop")) continue;
      try {
        const record = JSON.parse(line);
        const c = record && record.message && record.message.content;
        const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || "").join(" ") : "";
        if (record && record.type === "user" && /^\s*(?:<command-name>)?\/loop\b/.test(text)) {
          hits.push({ file, project: path.basename(path.dirname(file)), timestamp: record.timestamp || null });
          break;
        }
      } catch {
        continue;
      }
    }
    if (hits.length >= 25) break;
  }
  return { filesScanned: files.length, hits, limitation: "Text proxy for loop activity; authoritative loop burn is in native /usage Loops rows." };
}

async function main() {
  const dir = arg("projects-dir", path.join(homeDir(), ".claude", "projects"));
  const activeMinutes = Number(arg("active-minutes", 60));
  const activeCutoff = Date.now() - activeMinutes * 60000;
  const files = await listJsonlFiles(dir);
  const active = [];
  for (const file of files) {
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtime >= activeCutoff) active.push({ file, mtime });
  }
  const activeProjects = {};
  for (const entry of active.slice(0, 100)) {
    const models = {};
    await scanAssistantRecords(entry.file, (record) => {
      models[record.message.model] = (models[record.message.model] || 0) + 1;
    });
    const project = path.basename(path.dirname(entry.file));
    activeProjects[project] = activeProjects[project] || { sessions: [], models: {} };
    activeProjects[project].sessions.push({ file: entry.file, mtime: new Date(entry.mtime).toISOString() });
    for (const [model, count] of Object.entries(models)) {
      activeProjects[project].models[model] = (activeProjects[project].models[model] || 0) + count;
    }
  }
  let localSessions = [];
  try {
    localSessions = fs.readdirSync(path.join(homeDir(), ".claude", "sessions")).slice(0, 50);
  } catch {
    localSessions = [];
  }
  const result = {
    generatedAt: new Date().toISOString(),
    projectsDir: dir,
    activeMinutes,
    activeProjects,
    localSessionEntries: localSessions,
    loopMentions: await loopMentions(dir, arg("recent-days", 7)),
    scheduledTasks: await scheduledTasks(),
    manualChecks: [
      "claude agents — confirm the header model and close idle background sessions",
      "Native /usage Loops rows — authoritative scheduled-burst burn",
      "Settings > Usage — weekly percent and reset; subtract local Code total for the non-Code share",
      "Desktop Routines page and Cowork scheduled tasks — cloud/local jobs invisible to transcript parsing"
    ],
    limitation: "Transcript mtimes are a proxy for activity, not a live process list."
  };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`usage-max inventory: ${result.generatedAt}`);
  console.log(`active transcript projects (last ${activeMinutes}m):`);
  for (const [project, info] of Object.entries(result.activeProjects)) {
    console.log(`  ${project}: sessions=${info.sessions.length} models=${JSON.stringify(info.models)}`);
  }
  console.log(`loop mentions: scanned=${result.loopMentions.filesScanned} hits=${result.loopMentions.hits.length}`);
  console.log(`scheduled-task matches: ${result.scheduledTasks.matches.length} (${result.scheduledTasks.method})`);
  for (const check of result.manualChecks) console.log(`- ${check}`);
}

await main();
