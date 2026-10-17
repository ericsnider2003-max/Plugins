#!/usr/bin/env node
import assert from "node:assert/strict";
import { identifyModel, accountAllowed, validateAccountRegistry } from "../scripts/identity.mjs";

const at = "2026-10-15T06:00:00Z";
const codex = identifyModel({ type: "turn_context", payload: { model_id: "gpt-6.1-sol" } }, { surface: "codex-cli", observedAt: at });
assert.deepEqual({ provider: codex.provider, rawId: codex.rawId, canonicalId: codex.canonicalId, family: codex.family, sourceField: codex.sourceField, known: codex.known }, { provider: "openai", rawId: "gpt-6.1-sol", canonicalId: "gpt-6.1-sol", family: "sol", sourceField: "payload.payload.model_id", known: true });
assert.equal(identifyModel({ model: "gpt-6.1-sol", reasoning_effort: "high" }, { surface: "codex-cli" }).effort, "high");

const nested = identifyModel({ session_meta: { model: { id: "gpt-5.6-luna" } } }, { surface: "codex-desktop" });
assert.equal(nested.canonicalId, "gpt-5.6-luna");
assert.equal(nested.provider, "openai");
for (const id of ["gpt-4o", "gpt-4.1-mini", "o3", "o4-mini", "chatgpt-4o-latest", "gpt-5", "gpt-5-thinking", "gpt-5-thinking-pro", "gpt-5.4", "gpt-5.4-thinking", "gpt-5.4-thinking-pro", "gpt-5.4-mini"]) assert.equal(identifyModel({ model: id }, { surface: "chatgpt" }).known, true);
assert.equal(identifyModel({ conversation_model: "gpt-4o" }, { surface: "chatgpt" }).sourceField, "payload.conversation_model");
assert.equal(identifyModel({ selectedModel: "gpt-4.1-mini" }, { surface: "cowork" }).canonicalId, "gpt-4.1-mini");

const claude = identifyModel({ model_name: "claude-sonnet-5-5" }, { surface: "claude-code" });
assert.equal(claude.provider, "anthropic");
assert.equal(claude.family, "sonnet");

const actor = identifyModel({ model: "codex-auto-review" }, { surface: "codex-cli" });
assert.equal(actor.actor, "auto-review");
assert.equal(actor.known, false);
assert.equal(actor.canonicalId, null);

const unknown = identifyModel({ model: "future-provider-model" }, { surface: "chatgpt" });
assert.equal(unknown.provider, "openai");
assert.equal(unknown.known, false);
assert.equal(unknown.canonicalId, null);
const structurallyShapedButUnregistered = identifyModel({ model: "gpt-99-future" }, { surface: "chatgpt" });
assert.equal(structurallyShapedButUnregistered.known, false);
assert.equal(structurallyShapedButUnregistered.canonicalId, null);
const conflictingSurface = identifyModel({ model: "claude-sonnet-5-5" }, { surface: "chatgpt" });
assert.equal(conflictingSurface.provider, "unknown");
assert.equal(conflictingSurface.known, true);

const missing = identifyModel({ event: "turn_context" }, { surface: "codex-cli" });
assert.equal(missing.rawId, null);
assert.equal(missing.sourceField, null);
assert.equal(missing.provider, "openai");

const registry = { contract: "usage-max.account-registry.v1", accounts: [{ slot: "openai-primary", provider: "openai", surfaces: ["codex-cli"], homeFingerprint: "sha256-home-001", approved: true, enabled: true }, { slot: "openai-paused", provider: "openai", surfaces: ["chatgpt"], homeFingerprint: "sha256-home-002", approved: true, enabled: false }] };
assert.deepEqual(validateAccountRegistry(registry), { ok: true });
assert.equal(accountAllowed("openai-primary", registry), true);
assert.equal(accountAllowed("openai-paused", registry), false);
assert.equal(accountAllowed("missing", registry), false);
assert.equal(validateAccountRegistry({ ...registry, accounts: [{ ...registry.accounts[0] }, { ...registry.accounts[0] }] }).ok, false);
console.log("identity tests passed");
