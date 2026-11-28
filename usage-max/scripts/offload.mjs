// Local-model offload: send BOUNDED text jobs to a model running on THIS machine (Ollama by default) so they cost no plan usage.
//   usage-max offload status                     is a local model ready? which one?
//   usage-max offload <job> <file...> [--model m]  job = summarize | commit | explain | docstrings | convert:<format>
//   (also reads stdin: git diff | usage-max offload commit)
// Safety, on purpose: loopback endpoints only (127.0.0.1/localhost/::1), so code never leaves your machine; refuses files that look like
// secrets; input capped. Every answer must pass its job's deterministic check (offload-check.mjs); a failing answer is retried, and if all tries
// fail nothing is returned (exit 1) so Claude does the job. Jobs with no check are refused. Nothing here installs or downloads a model.
import fs from "node:fs"; import path from "node:path";
import { dataDir } from "./meter.mjs";
import { bump } from "./guard.mjs";
import { looksSecret } from "./memory.mjs";
import { workbenchAvailable } from "./workbench.mjs";
import { checkAnswer, hasCheck, stripFence } from "./offload-check.mjs";
export const HOST = () => process.env.USAGE_MAX_OLLAMA || "http://127.0.0.1:11434";
export const MAX_IN = 60000;
export const JOBS = {
  summarize: "Summarize the text below for a developer in at most 12 short bullet points. Keep names, numbers and error messages exact. Do not invent anything that is not in the text.",
  commit: "Write a git commit message for the diff below: a subject line of at most 72 characters in the imperative mood, a blank line, then at most 5 short bullets saying what changed and why. Mention only changes that are in the diff.",
  explain: "Explain in plain language what the code or log below does, in at most 10 sentences. Quote exact names. If something is unclear, say so instead of guessing.",
  docstrings: "Write concise docstrings/comments for the functions in the code below. Output only the code with the docstrings added; change no logic."
};
const SECRET_NAME = /(^|[\\/])(\.env(\..*)?|id_rsa|id_ed25519|.*\.(pem|key|p12|pfx|keystore)|credentials(\.json)?|\.npmrc|\.netrc)$/i;
const SECRET_BODY = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/;
export const isLoopback = (u) => { try { const h = new URL(u).hostname.replace(/^\[|\]$/g, ""); return h === "localhost" || h === "127.0.0.1" || h === "::1"; } catch { return false; } };
export function secretReason(name, text) { if (SECRET_NAME.test(name || "")) return `${name} looks like a secrets file`; if (SECRET_BODY.test(text || "") || looksSecret(text)) return `${name || "input"} contains something that looks like a key or token`; return null; }
export function buildPrompt(job, text) {
  let inst = JOBS[job]; if (!inst && /^convert:/.test(job)) inst = `Convert the text below to ${job.slice(8).replace(/[^\w .+-]/g, "").slice(0, 30)}. Output only the converted result.`;
  if (!inst) return null; return `${inst}\n\n--- BEGIN INPUT ---\n${text}\n--- END INPUT ---`;
}
const j = async (url, init, ms = 8000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { const r = await fetch(url, { ...init, signal: c.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } finally { clearTimeout(t); } };
export async function status(host = HOST()) {
  if (!isLoopback(host)) return { ready: false, why: `${host} is not a local address; offload only talks to this machine` };
  try { const t = await j(host + "/api/tags", {}, 3000); const models = (t.models || []).map((m) => m.name); return models.length ? { ready: true, models, host } : { ready: false, why: "Ollama is running but has no models. Pull a small one yourself, e.g. `ollama pull qwen2.5-coder:7b`" }; }
  catch { return { ready: false, why: "no local model server found at " + host + ". Install Ollama (ollama.com), then `ollama pull qwen2.5-coder:7b` (or any model your PC can run)." }; }
}
export const pickModel = (models, want) => (want && models.includes(want) ? want : models.find((m) => /coder|qwen|llama|mistral|phi|gemma/i.test(m)) || models[0]);
export async function run(job, text, { host = HOST(), model = null, name = "stdin", tries = 3 } = {}) {
  const p = buildPrompt(job, text); if (!p) return { error: `unknown job "${job}". Jobs: ${Object.keys(JOBS).join(", ")}, convert:<format>` };
  if (text.length > MAX_IN) return { error: `input is ${text.length} characters; offload takes at most ${MAX_IN}. Send a smaller piece (a diff of one area, one file)` };
  const bad = secretReason(name, text); if (bad) return { error: `refused: ${bad}. Offload is for ordinary code and logs.` };
  const s = await status(host); if (!s.ready) return { error: s.why };
  if (!hasCheck(job)) return { error: `no check exists for "${job}"; offload only returns checked answers. Formats with a check: json, csv, tsv` };
  const m = pickModel(s.models, model), failures = [];
  for (let n = 1; n <= tries; n++) {
    const prompt = n === 1 ? p : p + `

Your previous answer was rejected: ${failures[n - 2]}. Answer again, following every rule.`;
    let out, cut = false;
    try {
      const r = await j(host + "/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: m, prompt, stream: false, options: { temperature: n === 1 ? 0.2 : 0.5, num_predict: 900 } }) }, 180000);
      out = stripFence(r.response, job); cut = r.done_reason === "length";
    } catch (e) { return { error: "local model call failed: " + (e && e.message) }; }
    const c = !out ? { ok: false, why: "the local model returned nothing" } : cut ? { ok: false, why: "the answer was cut off before it finished" } : checkAnswer(job, text, out);
    if (c.ok) {
      try { bump(dataDir(), "offloadJobs"); bump(dataDir(), "offloadInputChars", text.length); bump(dataDir(), "offloadOutputChars", out.length); } catch {}
      return { ok: true, checked: true, check: c.check, model: m, tries: n, maxTries: tries, out };
    }
    failures.push(c.why); try { bump(dataDir(), "offloadRejected"); } catch {}
  }
  return { error: `local answer failed its check after ${tries} tries (${failures[failures.length - 1]}); do this job with Claude`, checked: false, failures };
}
export async function main(args) {
  const [job, ...rest] = args;
  if (!job || job === "status") {
    const [w, s] = await Promise.all([workbenchAvailable(), status()]), L = [];
    L.push(w.available ? `1. workbench (preferred, CHECKED): available. Use the workbench MCP tools: wb_quick for a one-file change with examples, wb_delegate with tests for bigger work; kb_search for code-map lookups. Results come back PASS only after tests ran.` : `1. workbench (preferred, CHECKED): not available (${w.why}). Do the work with Claude tiers.`);
    L.push(s.ready ? `2. Ollama (checked jobs): ready: ${s.models.join(", ")} at ${s.host}. Jobs: commit, docstrings, summarize, explain, convert:json|csv|tsv. Each answer must pass its job's check (up to 3 tries) or nothing is returned. usage: usage-max offload <job> <file...> (or pipe text in)` : "2. Ollama (checked jobs): NOT ready: " + s.why);
    console.log(L.join("\n")); return w.available || s.ready ? 0 : 1;
  }
  const mi = rest.indexOf("--model"), model = mi >= 0 ? rest[mi + 1] : null, files = rest.filter((x, i) => !x.startsWith("--") && !(mi >= 0 && i === mi + 1));
  let text = "", name = "stdin";
  if (files.length) { name = files.join(","); for (const f of files) { const reason = secretReason(path.basename(f), ""); if (reason) { console.error(`refused: ${reason}.`); return 1; } try { text += `\n### ${f}\n` + fs.readFileSync(f, "utf8"); } catch { console.error("cannot read " + f); return 1; } } }
  else if (!process.stdin.isTTY) { for await (const c of process.stdin) text += c; } else { console.error("give a file, or pipe text in"); return 1; }
  const r = await run(job, text, { model, name }); if (r.error) { console.error(r.error); return 1; }
  console.log(r.out + `\n\n[local model ${r.model}: checked (${r.check}), try ${r.tries} of ${r.maxTries}]`); return 0;
}
