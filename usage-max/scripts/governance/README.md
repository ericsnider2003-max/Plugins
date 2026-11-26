# usage-max governance core

Ported from Umbrella Project `skills/usage-max/` (Umbrella commit 0e94f22 tree, 2026-11-24).
Behaviour and API are identical to the Umbrella originals; Umbrella callers depend on them.
Library, plus `verify-receipts.mjs <root> <workId> <attemptId>` and the `usage-max work` CLI (below).

Umbrella `skills/usage-max/*.mjs` are shims over these modules; Umbrella `validation/validate-usage-max-drift.mjs` fails if a shim holds logic of its own or its exports differ from this directory.
`work-contract.mjs` is Umbrella-owned (source: Umbrella `skills/capability-routing/work-contract.mjs`); this copy must keep an identical body (the drift test compares them).

## Modules
- `identifiers.mjs`: `assertSafeIdentifier` rejects path characters, over 128 chars, empty.
- `controller.mjs`: `planUsageRoute`, `verifyUsageOutcome` (route choice, batch gate, quality floor).
- `route-registry.mjs`: `createRouteRegistry`, `routesForTask`, `verifyRouteEvidence`, `getRouteProfile`, `localWorkbenchRoute` (the measured, checked local-workbench profile; evidence in data/evidence/).
- `queue-gate.mjs`: `admitWorkUnit`, `verifyAdmission`, `recordUsageOutcome`, `UsageAdmissionError`.
- `requirement-verifier.mjs`: `verifyTaskArtifact` (required fields / work contract).
- `work-contract.mjs`: work-contract compile/verify (from Umbrella `skills/capability-routing/`).
- `durable-queue.mjs`: `enqueueWorkUnit`, `admitQueuedWorkUnit`, `checkpointWorkUnit`, `completeWorkUnit`,
  `prepareRetryWorkUnit`, `readQueuedWorkUnit`, `verifyQueueRecord`, `recoverAbandonedWorkUnit`.
- `verify-receipts.mjs`: `verifyUsageReceipts(root, workId, attemptId)` and the CLI above.
- `coordinator.mjs`: `dispatchQueuedWorkUnit` (legacy `dispatchWorkUnit` is disabled).
- `parallel-dispatch.mjs`: `planParallelSkills`, `dispatchParallelSkillWork`, `verifyParallelReceipt`.
- `provider-observation.mjs`: `normalizeCodexAppLimits` (Codex app limits to an observation).
- `live-observation.mjs`: `readLiveCodexObservation`, `resolveApprovedCodexSlot`.

## Enforced behavior
This is the single statement of the governance rules (Umbrella `skills/usage-max/SKILL.md` points here).
- Prefer deterministic/local routes before model or remote routes.
- Select the cheapest available route that meets the declared capability and quality floors.
- Treat missing, stale, refused, or local-estimate allowance as non-fresh; never convert it to zero or claim provider savings.
- Continue interactive work in bounded units when allowance is unknown or stale; do not silently stop an authorized task.
- Hold batch, CI, and evaluation work unless allowance is fresh and the recovery reserve is sufficient.
- Require checkpointing and independently verify quality/evidence before promotion. A cheaper route that loses requirements must escalate or reopen.
- Record a route fingerprint so provider/model/surface changes are new attempts.
- For canonical capability work, preserve the compact work contract: one objective, one bounded step, acceptance, required evidence, next action, and stop predicate. A status-only result fails verification, and enforced capability work needs a contract-bound durable receipt; usage savings never lower that floor.
- `coordinator.mjs` admits first, resolves only an explicit executor registry, runs the executor, and records the outcome before returning. `route-registry.mjs` rejects unbound route profiles. `durable-queue.mjs` fences stale attempts. `parallel-dispatch.mjs` composes governed work units (dependency-safe, write-scope-isolated waves, optional aggregate unit budget); it is not a bypass around admission.
- `provider-observation.mjs` strips provider account identifiers and keeps freshness explicit; `live-observation.mjs` consumes only a fresh `provider-live` snapshot, resolves one approved slot, and fails closed on stale or fallback captures.
- It never calls a provider, reads credentials, or claims billing authority.

## Acceptance boundary
Proves routing/admission control and quality preservation in local fixtures. It does not prove host-level model switching, provider billing reconciliation, or savings in a given host surface; those need a trusted host adapter and paired before/after measurements.

## State layout
Under `<root>/operations/runs/usage-max/`: `queue/` (work units, leases, locks), `events/` (admission and
outcome receipts), `parallel/` (parallel dispatch receipts). `root` is always passed by the caller.
Use a root outside OneDrive: `renameSync` over an existing file can fail with EPERM/EBUSY under sync or AV.

## Provider data
`live-observation.mjs` reads `~/.usage-max/provider-limits.json` (env `USAGE_MAX_PROVIDER_CACHE`) and
`~/.usage-max/accounts.json` (approved slot; env `USAGE_MAX_ACCOUNT_SLOT`). These are the files the plugin's
`scripts/provider-limits.mjs` and `scripts/accounts-cli.mjs` write.

## CLI: `usage-max work`
`scripts/work-cli.mjs`. Root: `--root <dir>`, default `<data dir>/work` (`~/.claude/usage-max/work`, or under `USAGE_MAX_HOME`); a OneDrive root warns.
```
usage-max work enqueue task.json   # {"workId":"W-1","task":{"id":"W-1","qualityThreshold":0.85,"requiredCapabilities":["extract"]}}
usage-max work list [--json]       # workId  state  attempt N  updated   (INVALID when the record fails verification)
usage-max work show W-1            # verified record as JSON; non-zero if tampered
usage-max work verify W-1 <attemptId>   # exit 0 pass, 1 fail
usage-max work recover [--json]    # units with an expired lease become retryable
```
Exit 2 for a bad subcommand/arguments or an invalid identifier. admit/checkpoint/complete/retry need a route registry
and executors, so they stay programmatic (this directory).

## Not related
The plugin's `queue` CLI verb (`scripts/guard.mjs`, FIFO) is unrelated and unchanged.

Tests: `node usage-max/test/governance.mjs`.
