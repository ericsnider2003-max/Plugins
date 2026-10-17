// Local host-adapter boundary. A supported adapter writes a redacted capture
// envelope here; the service ingests it without credentials or chat prompts.
import fs from "node:fs";
import path from "node:path";
import { loadAccounts, resolveAccount } from "./accounts.mjs";
import { ingestCaptures } from "./provider-ingest.mjs";
import { defaultObservationLedger } from "./provider-ingest.mjs";
import { adapterAllowed } from "./adapter-policy.mjs";

const surfaces = ["claude-code", "claude-desktop", "codex-cli", "codex-desktop", "chatgpt", "chatgpt-desktop", "cowork"];
const dir = (home) => path.join(home, ".usage-max", "attachments");
export function attachmentDirectory(home) { return dir(home); }
export function readAttachmentEnvelopes(home) {
  if (!fs.existsSync(dir(home))) return [];
  return fs.readdirSync(dir(home)).filter((x) => x.endsWith(".json")).flatMap((name) => {
    try { const value = JSON.parse(fs.readFileSync(path.join(dir(home), name), "utf8")); return value?.surface && value?.capture ? [{ ...value, file: name }] : []; } catch { return []; }
  });
}
export function ingestAttachments(home, { now = Date.now() } = {}) {
  const registry = loadAccounts(path.join(home, ".usage-max", "accounts.json")); const results = [];
  for (const envelope of readAttachmentEnvelopes(home)) {
    if (!surfaces.includes(envelope.surface)) { results.push({ file: envelope.file, accepted: false, reason: "unsupported surface" }); continue; }
    const policy = adapterAllowed(home, envelope.surface, envelope.capture);
    if (!policy.allowed) { results.push({ file: envelope.file, accepted: false, reason: policy.reason, adapter: policy.id }); continue; }
    const provider = envelope.surface.includes("claude") || envelope.surface === "cowork" ? "anthropic" : envelope.surface.includes("browser") || envelope.surface.includes("mobile") ? "unknown" : "openai";
    const binding = resolveAccount(registry, { provider, surface: envelope.surface, providerAccountId: envelope.capture.account || envelope.capture.accountId || null }) || {};
    const captureKey = envelope.surface === "claude-code" || envelope.surface === "claude-desktop" ? "claude" : envelope.surface === "codex-cli" || envelope.surface === "codex-desktop" ? "codex" : envelope.surface;
    const trustedProducers = envelope.producer ? { [envelope.surface]: envelope.producer } : {};
    const result = ingestCaptures(defaultObservationLedger(home), { [captureKey]: envelope.capture }, { capturedAt: now, accountBindings: { [envelope.surface]: binding, chatgpt: binding, chatgptDesktop: binding, claude: binding, codex: binding }, accountSlots: {}, trustedProducers });
    results.push({ file: envelope.file, accepted: true, added: result.filter((x) => x.added).length, duplicates: result.filter((x) => x.duplicate).length, approved: Boolean(binding.approved) });
  }
  return results;
}
