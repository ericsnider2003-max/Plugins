import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { recordCost } from "./pricing.mjs";
import { modelVersion } from "./ceiling.mjs";

export function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeUsage(usage) {
  const zero = {
    input: 0,
    output: 0,
    created: 0,
    read: 0,
    thinking: 0,
    webSearch: 0,
    webFetch: 0,
    created5m: 0,
    created1h: 0
  };
  if (!usage || typeof usage !== "object") return zero;
  let input = asNumber(usage.input_tokens);
  let output = asNumber(usage.output_tokens);
  let created = asNumber(usage.cache_creation_input_tokens);
  let read = asNumber(usage.cache_read_input_tokens);
  const details = usage.output_tokens_details;
  const thinking = details && typeof details === "object" ? asNumber(details.thinking_tokens) : 0;
  const server = usage.server_tool_use;
  const webSearch = server && typeof server === "object" ? asNumber(server.web_search_requests) : 0;
  const webFetch = server && typeof server === "object" ? asNumber(server.web_fetch_requests) : 0;
  if (input === 0 && output === 0 && created === 0 && read === 0 && Array.isArray(usage.iterations)) {
    for (const turn of usage.iterations) {
      const part = normalizeUsage(turn);
      input += part.input;
      output += part.output;
      created += part.created;
      read += part.read;
    }
  }
  const cc = usage.cache_creation && typeof usage.cache_creation === "object" ? usage.cache_creation : null;
  const created5m = cc ? asNumber(cc.ephemeral_5m_input_tokens) : 0;
  const created1h = cc ? asNumber(cc.ephemeral_1h_input_tokens) : created - created5m;
  return { input, output, created, read, thinking, webSearch, webFetch, created5m, created1h: Math.max(created1h, 0) };
}

export function contextTokens(usage) {
  return usage.input + usage.created + usage.read;
}

export function modelFamily(model) {
  const name = String(model || "").toLowerCase();
  if (name.includes("haiku")) return "haiku";
  if (name.includes("sonnet")) return "sonnet";
  if (name.includes("opus")) return "opus";
  if (name.includes("fable")) return "fable";
  if (name.includes("synthetic")) return "synthetic";
  return "other";
}

export function parseTimestamp(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Weekly reset spec "sun 07:00" (local time). Source order: explicit arg, USAGE_MAX_RESET env,
// ~/.claude/usage-max/config.json {"weeklyReset": "..."}, default "sun 07:00".
export function parseResetSpec(spec) {
  const m = String(spec || "").trim().toLowerCase().match(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  return { day: DAYS.indexOf(m[1]), hour, minute };
}

export function resolveResetSpec(explicit = null, homeDir = null) {
  const candidates = [explicit, process.env.USAGE_MAX_RESET];
  if (homeDir) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(homeDir, ".claude", "usage-max", "config.json"), "utf8"));
      candidates.push(cfg.weeklyReset);
    } catch {}
  }
  for (const c of candidates) {
    const parsed = parseResetSpec(c);
    if (parsed) return { ...parsed, source: c === explicit ? "arg" : c === process.env.USAGE_MAX_RESET ? "env" : "config" };
  }
  return { day: 0, hour: 7, minute: 0, source: "default" };
}

export function weeklyStart(now = new Date(), spec = { day: 0, hour: 7, minute: 0 }) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() - spec.day + 7) % 7), spec.hour, spec.minute, 0, 0);
  if (start.getTime() > now.getTime()) start.setDate(start.getDate() - 7);
  return start;
}

// Ceiling: Opus 5.5. Returns "ok" | "above" | "unknown".
export const CEILING = { family: "opus", version: 5.5 };
export { modelVersion };
export function ceilingStatus(model) {
  const family = modelFamily(model);
  if (family === "synthetic") return "ok";
  if (family === "fable") return "above";
  if (family === "haiku" || family === "sonnet" || family === "opus") {
    const v = modelVersion(model);
    if (v === null) return "unknown"; // an id whose version cannot be read is never "ok" by accident
    return family !== "opus" || v <= CEILING.version ? "ok" : "above";
  }
  return "unknown";
}

export function toolCallNames(message) {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content
    .filter((item) => item && item.type === "tool_use" && typeof item.name === "string")
    .map((item) => item.name);
}

export async function listJsonlFiles(root) {
  const found = [];
  async function walk(directory) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        found.push(full);
      }
    }
  }
  await walk(root);
  return found.sort();
}

// Claude Code writes one transcript record per content block (thinking / text / tool_use) and every one
// repeats the same message.usage, so summing records double-counts. Count each message.id once.
// Pass { includeDuplicates: true } to also receive the repeat records (flagged duplicate=true) so callers can
// still read their content blocks (tool_use) without double-counting usage.
export async function scanAssistantRecords(file, onRecord, { includeDuplicates = false } = {}) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const seen = new Set();
  for await (const line of lines) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record && record.type === "assistant" && record.message && record.message.model) {
      const id = record.message.id;
      let duplicate = false;
      if (id) {
        duplicate = seen.has(id);
        seen.add(id);
      }
      if (duplicate && !includeDuplicates) continue;
      onRecord(record, file, duplicate);
    }
  }
}

// One message can appear many times: one record per content block, and sub-agent / resumed transcripts copy parent messages into other files.
// Count each message id once, keeping the copy with the largest output_tokens (a streaming update supersedes the partial count; ties: the latest).
// Records without an id are never merged. add(message, item) takes any caller payload; items() returns the winners in first-seen order.
export function createDeduper() {
  const byId = new Map(), slots = [];
  return {
    add(message, item) {
      const id = message && message.id, out = normalizeUsage(message && message.usage).output;
      const slot = id ? byId.get(id) : null;
      if (!slot) { const s = { item, out }; slots.push(s); if (id) byId.set(id, s); } else if (out >= slot.out) { slot.item = item; slot.out = out; }
    },
    items: () => slots.map((x) => x.item)
  };
}

function emptyModelBucket() {
  return {
    turns: 0,
    sidechainTurns: 0,
    input: 0,
    output: 0,
    created: 0,
    read: 0,
    context: 0,
    thinking: 0,
    toolCalls: 0,
    cost: 0,
    ranges: {}
  };
}

function addUsage(bucket, usage, toolCalls, cost = 0) {
  bucket.cost += cost;
  bucket.turns += 1;
  bucket.input += usage.input;
  bucket.output += usage.output;
  bucket.created += usage.created;
  bucket.read += usage.read;
  bucket.context += contextTokens(usage);
  bucket.thinking += usage.thinking;
  bucket.toolCalls += toolCalls;
}

export async function summarizeProjects({
  projectsDir,
  since = 0,
  windows = {},
  toolCallSpike = 25,
  contextSpike = 200000,
  onFile = null
} = {}) {
  const files = await listJsonlFiles(projectsDir);
  const summary = {
    files: 0,
    assistantTurns: 0,
    sidechainTurns: 0,
    models: {},
    projects: {},
    sessions: {},
    spikes: [],
    rework: { repeatedFiles: {}, repeatedCommands: {} },
    ranges: { all: emptyModelBucket() }
  };
  for (const key of Object.keys(windows)) summary.ranges[key] = emptyModelBucket();

  // Pass 1: read every transcript once, keeping only what the summary needs (usage, tool calls). The winner of each message id is picked across ALL files.
  const slim = (message) => ({ id: message.id, model: message.model, usage: message.usage, content: (Array.isArray(message.content) ? message.content : []).filter((c) => c && c.type === "tool_use" && c.input && typeof c.input === "object").map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: { file_path: c.input.file_path, command: typeof c.input.command === "string" ? c.input.command.slice(0, 160) : undefined } })) });
  const winners = new Map(), perFile = [];
  for (const file of files) {
    const records = [];
    await scanAssistantRecords(file, (record) => {
      const message = slim(record.message), out = normalizeUsage(message.usage).output;
      const rec = { file, timestamp: parseTimestamp(record.timestamp), sidechain: record.isSidechain === true, message, out };
      records.push(rec);
      const cur = message.id ? winners.get(message.id) : null;
      if (message.id && (!cur || out >= cur.out)) winners.set(message.id, rec);
    }, { includeDuplicates: true });
    perFile.push({ file, records });
  }
  const isPrimary = (rec) => !rec.message.id || winners.get(rec.message.id) === rec;
  const inWindow = (rec) => !rec.timestamp || rec.timestamp >= since;
  // Pass 2: one turn per message (its winning copy). Tool calls of the other copies are added afterwards, once per tool_use id.
  const seenTools = new Set();
  const newTools = (message) => message.content.filter((c) => !c.id || !seenTools.has(c.id));
  for (const { file, records } of perFile) {
    let fileBucket = null;
    for (const rec of records) {
      if (!isPrimary(rec) || !inWindow(rec)) continue;
      const { timestamp, message } = rec;
      const model = message.model;
      const usage = normalizeUsage(message.usage);
      const tools = toolCallNames(message);
      for (const c of message.content) if (c.id) seenTools.add(c.id);
      const sidechain = rec.sidechain;
      const project = path.basename(path.dirname(file));
      const session = path.basename(file, ".jsonl");

      const cost = recordCost(message);
      summary.assistantTurns += 1;
      if (sidechain) summary.sidechainTurns += 1;
      summary.models[model] = summary.models[model] || emptyModelBucket();
      addUsage(summary.models[model], usage, tools.length, cost);
      if (sidechain) summary.models[model].sidechainTurns += 1;
      for (const [name, start] of Object.entries(windows)) {
        if (timestamp >= start) {
          summary.models[model].ranges[name] = summary.models[model].ranges[name] || emptyModelBucket();
          addUsage(summary.models[model].ranges[name], usage, tools.length, cost);
        }
      }
      addUsage(summary.ranges.all, usage, tools.length, cost);
      for (const [name, start] of Object.entries(windows)) {
        if (timestamp >= start) addUsage(summary.ranges[name], usage, tools.length, cost);
      }

      summary.projects[project] = summary.projects[project] || emptyModelBucket();
      addUsage(summary.projects[project], usage, tools.length, cost);
      summary.sessions[file] = summary.sessions[file] || { project, session, ...emptyModelBucket() };
      addUsage(summary.sessions[file], usage, tools.length, cost);
      fileBucket = summary.sessions[file];

      const context = contextTokens(usage);
      if (tools.length >= toolCallSpike || context >= contextSpike) {
        summary.spikes.push({ file, session, project, timestamp, model, sidechain, toolCalls: tools.length, context });
      }
      trackRework(summary.rework, message);
    }
    if (fileBucket) {
      summary.files += 1;
      if (typeof onFile === "function") onFile(file, fileBucket);
    }
  }
  for (const { file, records } of perFile) {
    for (const rec of records) { // other copies of a counted message: its tokens are already counted, but not tool calls first seen on this copy
      if (isPrimary(rec)) continue;
      const winner = winners.get(rec.message.id);
      if (!inWindow(winner) || !summary.models[rec.message.model]) continue; // the message itself fell before the window start: so do its copies
      const fresh = newTools(rec.message);
      if (!fresh.length) continue;
      for (const c of fresh) if (c.id) seenTools.add(c.id);
      summary.models[rec.message.model].toolCalls += fresh.length;
      summary.ranges.all.toolCalls += fresh.length;
      if (summary.sessions[file]) summary.sessions[file].toolCalls += fresh.length;
      trackRework(summary.rework, { content: fresh });
    }
  }
  summary.spikes.sort((a, b) => b.context - a.context);
  return summary;
}

function trackRework(rework, message) {
  if (!message || !Array.isArray(message.content)) return;
  for (const item of message.content) {
    if (!item || item.type !== "tool_use" || !item.input || typeof item.input !== "object") continue;
    if ((item.name === "Edit" || item.name === "Write") && typeof item.input.file_path === "string") {
      const key = `${item.name}:${item.input.file_path}`;
      rework.repeatedFiles[key] = (rework.repeatedFiles[key] || 0) + 1;
    }
    if (item.name === "Bash" && typeof item.input.command === "string") {
      const key = item.input.command.slice(0, 160);
      rework.repeatedCommands[key] = (rework.repeatedCommands[key] || 0) + 1;
    }
  }
}

export function topEntries(map, limit = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1].context - a[1].context)
    .slice(0, limit)
    .map(([name, bucket]) => ({ name, ...bucket }));
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

// Pacing against a real plan window ({ used_percentage, resets_at } from the status line's rate_limits).
// Goal: finish the window near 100% without hitting it early. Pure function for testing.
export function pace(win, windowSeconds, nowMs = Date.now()) {
  if (!win || typeof win.used_percentage !== "number" || !win.resets_at) return null;
  const end = win.resets_at * 1000;
  const start = end - windowSeconds * 1000;
  const elapsed = Math.min(Math.max((nowMs - start) / (windowSeconds * 1000), 0), 1);
  const used = win.used_percentage;
  const hoursLeft = Math.max((end - nowMs) / 3600000, 0);
  if (elapsed < 0.02) return { used, elapsed, projected: null, hoursLeft, state: "early", capInHours: null };
  const rate = used / elapsed; // % per full window at the current burn
  const projected = rate;
  const capInHours = used >= 100 ? 0 : rate > 0 ? ((100 - used) / rate) * (windowSeconds / 3600) : null;
  let state = "on-pace";
  if (projected > 100 && capInHours !== null && capInHours < hoursLeft) state = "over";
  else if (projected < 85) state = "under";
  return { used, elapsed, projected, hoursLeft, state, capInHours };
}
