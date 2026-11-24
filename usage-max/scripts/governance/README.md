# usage-max governance core

Ported from Umbrella Project `skills/usage-max/` (Umbrella commit 0e94f22 tree, 2026-11-24).
Behaviour and API are identical to the Umbrella originals; Umbrella callers depend on them.
Library only: no CLI is added in this phase, except `verify-receipts.mjs <root> <workId> <attemptId>`.

## Modules
- `identifiers.mjs`: `assertSafeIdentifier` rejects path characters, over 128 chars, empty.
- `controller.mjs`: `planUsageRoute`, `verifyUsageOutcome` (route choice, batch gate, quality floor).
- `route-registry.mjs`: `createRouteRegistry`, `routesForTask`, `verifyRouteEvidence`, `getRouteProfile`.
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

## State layout
Under `<root>/operations/runs/usage-max/`: `queue/` (work units, leases, locks), `events/` (admission and
outcome receipts), `parallel/` (parallel dispatch receipts). `root` is always passed by the caller.
Use a root outside OneDrive: `renameSync` over an existing file can fail with EPERM/EBUSY under sync or AV.

## Provider data
`live-observation.mjs` reads `~/.usage-max/provider-limits.json` (env `USAGE_MAX_PROVIDER_CACHE`) and
`~/.usage-max/accounts.json` (approved slot; env `USAGE_MAX_ACCOUNT_SLOT`). These are the files the plugin's
`scripts/provider-limits.mjs` and `scripts/accounts-cli.mjs` write.

## Not related
The plugin's `queue` CLI verb (`scripts/guard.mjs`, FIFO) is unrelated and unchanged.

Tests: `node usage-max/test/governance.mjs`.
