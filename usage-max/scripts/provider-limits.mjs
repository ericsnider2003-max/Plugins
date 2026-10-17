// Cross-surface provider limit capture.
// Credentials are read only long enough to make a provider-owned GET; the cache
// contains normalized limits, provenance and timestamps, never tokens.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { defaultObservationLedger, ingestCaptures } from "./provider-ingest.mjs";
import { readCodexRateLimits, readCodexAccountUsage } from "../codex/scripts/codex-app-server.mjs";
import { loadAccounts, resolveAccount } from "./accounts.mjs";
import { appendAccountActivity, activityLedgerFile } from "./account-activity.mjs";

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_BETA = "oauth-2025-04-20";

const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};

function epoch(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n / 1000 : null;
}

function capture(provider, rateLimits, now = Date.now(), extra = {}) {
  return { capturedAt: new Date(now).toISOString(), source: provider, rate_limits: rateLimits, ...extra };
}

export function normalizeClaudeLimits(data, now = Date.now()) {
  if (!data || typeof data !== "object") throw new Error("Claude returned an invalid usage response");
  const out = {};
  if (Array.isArray(data.limits)) {
    for (const [i, item] of data.limits.entries()) {
      if (!item || typeof item !== "object") continue;
      const pct = Number(item.percent), reset = epoch(item.resets_at);
      if (!Number.isFinite(pct) || reset === null) continue;
      const kind = String(item.kind || `limit_${i}`);
      let label = kind === "session" ? "5-HOUR" : kind === "weekly_all" ? "WEEKLY" : kind.replaceAll("_", " ").toUpperCase();
      const model = item.scope?.model?.display_name || item.scope?.model?.id;
      if (kind === "weekly_scoped") label = `${model || "SCOPED"} WEEKLY`.toUpperCase();
      const key = kind === "session" ? "five_hour" : kind === "weekly_all" ? "seven_day" : kind;
      out[key in out ? `${key}_${i}` : key] = { label, used_percentage: pct, resets_at: reset };
    }
  }
  // Anthropic's current response also exposes named buckets at the top level.
  if (!Object.keys(out).length) for (const [key, item] of Object.entries(data)) {
    if (!item || typeof item !== "object") continue;
    const pct = Number(item.utilization), reset = epoch(item.resets_at);
    if (Number.isFinite(pct) && reset !== null) out[key] = { used_percentage: pct, resets_at: reset };
  }
  if (!Object.keys(out).length) throw new Error("Claude returned no usable limits");
  return capture("claude-api", out, now);
}

export function normalizeCodexLimits(data, now = Date.now()) {
  if (!data || typeof data !== "object") throw new Error("Codex returned an invalid rate-limit event");
  const raw = data.rate_limits || data;
  const groups = data.rateLimitsByLimitId || (raw.limit_id ? { [raw.limit_id]: raw } : {});
  const out = {};
  for (const [id, item] of Object.entries(groups)) {
    if (!item || typeof item !== "object") continue;
    const primary = item.primary || item;
    const secondary = item.secondary;
    for (const [slot, win] of [["primary", primary], ["secondary", secondary]]) {
      if (!win || typeof win !== "object") continue;
      const pct = Number(win.used_percent ?? win.usedPercent), reset = epoch(win.resets_at ?? win.resetsAt);
      if (!Number.isFinite(pct) || reset === null) continue;
      const mins = Number(win.window_minutes ?? win.windowDurationMins);
      const key = `${id}_${slot}`;
      out[key] = { label: mins >= 10000 ? "WEEKLY" : mins > 0 ? `${Math.round(mins / 60)}-HOUR` : key.toUpperCase(), used_percentage: pct, resets_at: reset, window_minutes: mins || null };
    }
  }
  if (!Object.keys(out).length) throw new Error("Codex event contained no usable limits");
  return capture("codex-rollout", out, now, { account: data.account || data.accountId || null });
}

function filesUnder(dir) {
  const out = [];
  const visit = (folder) => {
    let entries = []; try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(folder, e.name);
      if (e.isDirectory()) visit(f);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(f);
    }
  };
  visit(dir); return out;
}

export function latestCodexCapture(codexHome = path.join(os.homedir(), ".codex")) {
  let best = null;
  for (const file of filesUnder(path.join(codexHome, "sessions"))) {
    let lines = []; try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch { continue; }
    for (const line of lines) {
      if (!line.includes("rate_limits")) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      const payload = row?.payload || row;
      if (payload?.rate_limits) {
        const at = Date.parse(row.timestamp || "") || fs.statSync(file).mtimeMs;
        if (!best || at > best.at) best = { at, capture: normalizeCodexLimits(payload.rate_limits, at) };
      }
    }
  }
  return best?.capture || null;
}

// The app-server rate-limit method is authoritative for allowance but does not
// reliably include the selected model. Recover the newest model from local
// Codex activity as an identity signal only; it never upgrades local activity
// into provider allowance authority.
export function latestCodexModel(codexHome = path.join(os.homedir(), ".codex")) {
  let best = null;
  for (const file of filesUnder(path.join(codexHome, "sessions"))) {
    let lines = []; try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch { continue; }
    for (const line of lines) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      const payload = row?.payload || row;
      const model = payload?.model || payload?.model_id || payload?.modelId || payload?.model_slug || payload?.modelSlug;
      const effort = payload?.effort || payload?.reasoning_effort || payload?.reasoningEffort || payload?.effort_level || payload?.effortLevel || payload?.model_reasoning_effort || payload?.modelReasoningEffort || null;
      if (typeof model !== "string" || !model.trim()) continue;
      const at = Date.parse(row.timestamp || "") || fs.statSync(file).mtimeMs;
      if (!best || at > best.at) best = { at, model: model.trim(), effort: typeof effort === "string" ? effort.trim() : null, source: "codex-rollout" };
    }
  }
  return best;
}

function claudeToken(credentialsPath) {
  const oauth = readJson(credentialsPath)?.claudeAiOauth;
  return oauth && typeof oauth.accessToken === "string" ? oauth.accessToken : null;
}

function refreshClaude(configDir) {
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const r = spawnSync(exe, ["mcp", "list"], { cwd: configDir, env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }, stdio: "ignore", timeout: 30000 });
  return r.status === 0;
}

export async function fetchClaudeLimits({ home = os.homedir(), refresh = true, fetchImpl = fetch } = {}) {
  const configDir = path.join(home, ".claude");
  const credentialsPath = path.join(configDir, ".credentials.json");
  let token = claudeToken(credentialsPath);
  if (!token) throw new Error("Claude OAuth access token is unavailable");
  const request = async () => fetchImpl(CLAUDE_USAGE_URL, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "anthropic-beta": CLAUDE_BETA }, signal: AbortSignal.timeout(15000) });
  let response = await request();
  if (response.status === 401 && refresh) { refreshClaude(configDir); token = claudeToken(credentialsPath); response = await request(); }
  if (!response.ok) throw new Error(`Claude usage fetch failed: HTTP ${response.status}`);
  return normalizeClaudeLimits(await response.json());
}

export async function fetchCodexLimitsLive(options = {}) { return readCodexRateLimits(options); }
export async function fetchCodexAccountActivityLive(options = {}) { return readCodexAccountUsage(options); }

export async function captureProviderLimits({ home = os.homedir(), refreshClaude = true, write = true, ingest = true, codexLive = true, codexActivityLive = false } = {}) {
  const dataDir = path.join(home, ".usage-max");
  const cachePath = path.join(dataDir, "provider-limits.json");
  const old = readJson(cachePath, { captures: {} });
  const captures = { ...(old.captures || {}) };
  // Cached captures are useful for diagnostics, but never enter the ledger as
  // fresh provider evidence after a failed refresh. Only this map is eligible
  // for ingestion during the current call.
  const freshCaptures = {};
  const captureSources = {};
  const warnings = [];
  try { captures.claude = await fetchClaudeLimits({ home, refresh: refreshClaude }); freshCaptures.claude = captures.claude; captureSources.claude = "provider-live"; } catch (e) { warnings.push(`Claude: ${e.message}`); }
  if (codexLive) {
    try { captures.codex = await fetchCodexLimitsLive(); freshCaptures.codex = captures.codex; captureSources.codex = "provider-live"; }
    catch (e) { warnings.push(`Codex live read unavailable: ${e.message}`); }
  }
  if (!freshCaptures.codex) try { const c = latestCodexCapture(path.join(home, ".codex")); if (c) { captures.codex = c; freshCaptures.codex = c; captureSources.codex = "local-fallback"; } else warnings.push("Codex: no local rate_limits event found"); } catch (e) { warnings.push(`Codex local fallback: ${e.message}`); }
  if (freshCaptures.codex && !freshCaptures.codex.model) {
    try { const m = latestCodexModel(path.join(home, ".codex")); if (m) { captures.codex = { ...captures.codex, model: m.model, effort: m.effort || null, modelSource: m.source }; freshCaptures.codex = captures.codex; } }
    catch (e) { warnings.push(`Codex model identity: ${e.message}`); }
  }
  let accountActivity = null;
  if (codexActivityLive) {
    try { accountActivity = await fetchCodexAccountActivityLive(); if (write && accountActivity) appendAccountActivity(activityLedgerFile(home), accountActivity); }
    catch (e) { warnings.push(`Codex account activity unavailable: ${e.message}`); }
  }
  const captureStatus = Object.fromEntries(["claude", "codex"].map((provider) => [provider, captureSources[provider] === "local-fallback" ? "local-fallback" : freshCaptures[provider] ? "fresh" : captures[provider] ? "cached-stale" : "missing"]));
  const result = { capturedAt: new Date().toISOString(), captures, freshCaptures, captureStatus, captureSources, accountActivity, warnings };
  if (write) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(cachePath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
      const c = freshCaptures.claude;
    if (c?.rate_limits) { const limits = { capturedAt: c.capturedAt, source: c.source, ...c.rate_limits }; fs.mkdirSync(path.join(home, ".claude", "usage-max"), { recursive: true }); fs.writeFileSync(path.join(home, ".claude", "usage-max", "limits.json"), `${JSON.stringify(limits, null, 2)}\n`, { mode: 0o600 }); }
    if (ingest) {
      const registry = loadAccounts(path.join(dataDir, "accounts.json"));
      const claudeBinding = resolveAccount(registry, { provider: "anthropic", surface: "claude-code", home: path.join(home, ".claude") });
      const codexBinding = resolveAccount(registry, { provider: "openai", surface: "codex-cli", home: path.join(home, ".codex"), providerAccountId: captures.codex?.account || null });
      ingestCaptures(defaultObservationLedger(home), freshCaptures, { accountBindings: { claude: claudeBinding || {}, codex: codexBinding || {} } });
    }
  }
  return result;
}
