// Explicit capability registry. A surface is supported only when a trusted
// attachment is supplied by the host; Usage-max never scrapes private UIs.
const definitions = [
  { id: "claude-code", provider: "anthropic", surfaces: ["claude-code", "claude-desktop"], observation: "supported", notification: "attachment-required", control: "unavailable", taskLaunch: "attachment-required", handoff: "attachment-required", checkpointInjection: "attachment-required", resume: "attachment-required" },
  { id: "codex-app-server", provider: "openai", surfaces: ["codex-cli", "codex-desktop"], observation: "supported", notification: "attachment-required", control: "unavailable", taskLaunch: "attachment-required", handoff: "attachment-required", checkpointInjection: "attachment-required", resume: "attachment-required" },
  { id: "chatgpt", provider: "openai", surfaces: ["chatgpt", "chatgpt-desktop"], observation: "supplemental-required", notification: "attachment-required", control: "unavailable", taskLaunch: "unavailable", handoff: "unavailable", checkpointInjection: "unavailable", resume: "unavailable" },
  { id: "cowork", provider: "anthropic", surfaces: ["cowork"], observation: "supplemental-required", notification: "attachment-required", control: "unavailable", taskLaunch: "unavailable", handoff: "unavailable", checkpointInjection: "unavailable", resume: "unavailable" },
  { id: "browser", provider: "unknown", surfaces: ["browser", "mobile"], observation: "unavailable", notification: "unavailable", control: "unavailable", taskLaunch: "unavailable", handoff: "unavailable", checkpointInjection: "unavailable", resume: "unavailable" },
];

export function surfaceDefinitions() { return definitions.map((x) => ({ ...x, surfaces: [...x.surfaces] })); }
export function findSurface(surface) { return definitions.find((x) => x.surfaces.includes(surface)) || { id: "unknown", provider: "unknown", surfaces: [surface], observation: "unavailable", notification: "unavailable" }; }
export function capabilities(surface, { attachment = null, approved = false } = {}) {
  const def = findSurface(surface);
  const attached = Boolean(attachment && (attachment.attached === true || typeof attachment.capture === "function"));
  const notifyAttached = Boolean(attachment && typeof attachment.notify === "function");
  const capability = (name, fn) => def[name] === "attachment-required" && Boolean(attachment && typeof attachment[fn] === "function") && approved ? "supported" : "unavailable";
  return {
    surface, provider: def.provider, adapter: def.id,
    observation: def.observation === "supported" && attached && approved ? "supported" : def.observation === "supplemental-required" && attached && approved ? "supplemental" : "unavailable",
    notification: def.notification === "attachment-required" && notifyAttached && approved ? "supported" : "unavailable",
    control: capability("control", "control"), taskLaunch: capability("taskLaunch", "launch"), handoff: capability("handoff", "handoff"), checkpointInjection: capability("checkpointInjection", "checkpoint"), resume: capability("resume", "resume"),
    reason: !approved ? "account approval required" : !attached && ["supported", "supplemental-required"].includes(def.observation) ? "trusted observation attachment required" : def.observation === "unavailable" ? "no supported attachment for surface" : !notifyAttached ? "trusted notification attachment required" : null,
  };
}

export function manifest({ attachments = {}, approvals = {} } = {}) {
  return surfaceDefinitions().flatMap((def) => def.surfaces.map((surface) => capabilities(surface, { attachment: attachments[surface], approved: approvals[surface] === true })));
}
