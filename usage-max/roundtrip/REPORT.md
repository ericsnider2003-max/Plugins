# Code audit: usage-max
_2026-10-18 · scope: the whole project · checks loaded: trading-money, windows-host, scripts-ops, web-app_

**Readiness: Usable — no must-fix, but 1 action only you can take**

## Do today
- Nothing only you can do today. Approve the fix order below.

## The short version
- **What's broken:** The local control plane is hardened and full offline checks pass. Live provider evidence and guarded launch remain unavailable, so production enforcement is not ready.
- **What it could cost:** No confirmed open critical or high code defect remains after remediation. Remaining work is external integration and a guarded observation trial.
- **What fixing takes:** about 9 hours (6–12 h, 1–1.5 working days) across 1 fix.
- **What we need from you:** Attach fresh provider observations for ChatGPT/Cowork, complete an approved observation trial, and review the rollout gate before enforcement.

## Fix order
Most serious tier first; quick fixes lead only inside a tier.
1. **Medium — before it grows** (row 1): 1 fix · about 9 hours (6–12 h, 1–1.5 working days)

## What could happen
### Provider usage changes outside the local ledger
- **What happens:** the provider allowance moves without matching local activity, so routing stays conservative.
- **How likely:** whenever an unobserved surface consumes allowance.
- **Would you notice?** Yes: reconciliation records an unattributed movement and creates a review notice.
- **How you'd recover today:** refresh provider evidence; keep enforcement disabled until it matches.
- **Fixed by:** GAP-001 and local reconciliation safeguards.

### The service stops during a tick
- **What happens:** shutdown state is persisted and the service lock is released.
- **How likely:** on an exception or controlled stop.
- **Would you notice?** Yes: the service state shows stopped and the exception reaches the caller.
- **How you'd recover today:** inspect saved state and rerun after resolving the failure.
- **Fixed by:** GAP-001 and service-runner shutdown handling.

### A notification bridge rejects delivery
- **What happens:** the notice remains pending with its attempt count and failure reason.
- **How likely:** when a surface bridge is unavailable.
- **Would you notice?** Yes: the outbox stores the failure and the summary reports pending notices.
- **How you'd recover today:** restore the bridge; retry delivery.
- **Fixed by:** GAP-001 and durable outbox delivery metadata.

## All findings
In fix order. Effort: **S** = 2–4 hours, **M** = 6–12 hours, **L** = 16–32 hours. Severity: **critical** can lose money or hand over control now · **high** breaks normal operation · **medium** needs narrower conditions · **low** is housekeeping.

| # | Id | Severity | Effort | What's wrong | How you'll know it's fixed |
|--:|---|---|---|---|---|
| 1 | GAP-001 | medium | M | **Remaining scanner leads need end-to-end trace.** _(unconfirmed)_ | Review each lead and record a domain-backed dismissal or confirmed finding. |

---
## For your engineer

#### GAP-001 · medium · M
- What it means: Some refreshed scanner leads are not tied to a confirmed defect or documented safe control.
- Where: `roundtrip/baseline.json`
- Evidence (not yet confirmed): The refreshed baseline has leads outside the existing triage map; every lead must be classified.
- Fix: Complete lead triage and update the report before closing the audit.
- Test first: Run rt verify after every lead has a finding, dismissal, or this disposition.

## Script inventory
| Script | Destructive | Dry run | Stops on error | Lock | Logs | Exit code | Started by |
|---|---|---|---|---|---|---|---|
| `scripts/account-activity.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/accounts-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/accounts.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/action-approval.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/activation-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/activation-install.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/activation.mjs` | no | n/a | n/a | yes | **no** | **no** | not found |
| `scripts/adapter-policy-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/adapter-policy.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/admission.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/anomaly.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/architecture-graph.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/attachment-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/attachment-server.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/attachments.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/audit.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/auto-observe.mjs` | no | n/a | n/a | **no** | **no** | **no** | hooks/hooks.json |
| `scripts/autohandoff.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/background.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/blocks.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/browser-native-host.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/budgets.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/build-mcpb.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/build-plugin-zip.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/cachebreak.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/capability-dossier-cli.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/capability-dossier.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/ceiling.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/check.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/claude-headless-adapter.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/claude-lean.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/cleanup-old.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/collector-queue.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/compatibility-cli.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/compatibility-doctor.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/completion-verifier.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/context-bridge.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/context-continuity.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/control-report.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/coverage.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/cross-provider.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/ctxfiles.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/dashboard.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/diagnose.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/dupes.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/eval-cache.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/evidence.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/execution-profile.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/failure-health.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/governor.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/graphify.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/guard.mjs` | no | n/a | n/a | **no** | **no** | **no** | hooks/hooks.json |
| `scripts/handoff-pack.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/handoff.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/health-cli.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/health.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/host-runtime.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/host.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/identity.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/inventory.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/lib.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/managed-worker.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/memory-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/memory-suggest.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/memory.mjs` | no | n/a | n/a | **no** | **no** | yes | hooks/hooks.json |
| `scripts/meter.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/model-registry.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/notification-bridge.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/notification-router.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/notifications.mjs` | no | n/a | n/a | **no** | **no** | yes | hooks/hooks.json |
| `scripts/observation-adapters.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/observation-ledger.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/offload.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/owned.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/pack.mjs` | no | n/a | n/a | yes | yes | yes | not found |
| `scripts/plan-audit.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/plugin-diet.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/predictive-budget.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/pricing.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/process-discovery.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/profile.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/provider-ingest.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/provider-limits.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/provider-shape.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/readiness-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/readiness.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/reconcile.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/recovery.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/repo-verifier.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/repository-actions.mjs` | no | n/a | n/a | yes | **no** | **no** | not found |
| `scripts/repository-checks.mjs` | no | n/a | n/a | yes | **no** | **no** | not found |
| `scripts/reservations.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/resettime.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/resume-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/resume.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/rollout.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/safefile.mjs` | no | n/a | n/a | yes | **no** | yes | not found |
| `scripts/safety.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/savings.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/scheduler.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/service-runner.mjs` | no | n/a | n/a | yes | **no** | yes | not found |
| `scripts/session-search.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/session-suggest.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/sessionlog.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/shared.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/statusline.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/subagents-cli.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/subagents.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/summary-cli.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/summary.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/surface-adapters.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/task-console-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/task-console.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/task-finalizer.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/task-governance.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/task-policy.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/task-state.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/task-store.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/timing.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/trial-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/trial.mjs` | no | n/a | n/a | **no** | **no** | yes | not found |
| `scripts/trim.mjs` | no | n/a | n/a | **no** | **no** | yes | hooks/hooks.json |
| `scripts/trimtest.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/ttl.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/unattended-supervisor.mjs` | no | n/a | n/a | yes | **no** | yes | not found |
| `scripts/usage-advisor.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/usage-check.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |
| `scripts/usage-max.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/watchdog.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/worker-adapters.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/worker-loop.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/worker-service-cli.mjs` | no | n/a | n/a | **no** | yes | yes | not found |
| `scripts/worker-service.mjs` | no | n/a | n/a | **no** | **no** | **no** | not found |
| `scripts/workers-cli.mjs` | no | n/a | n/a | **no** | yes | **no** | not found |

## Coverage
| Area | Result | Evidence |
|---|---|---|
| Tests | OK | full offline suite, static checks |
| Input validation | OK | admission, reservation, lease, attachment guards |
| Error handling | OK | durable state and delivery failure tests |
| Logging and alerting | Gap | live surface notifications unavailable |
| Configuration and secrets | OK | scanner review, observation-only defaults |
| Dependencies | Gap | no lockfile/package source for OSV review |
| Concurrency | OK | locks and unique attachment writes |
| Resource cleanup | OK | service shutdown and lock release tests |
| Contracts | OK | control-plane contract suite |
| Deploy wiring | Gap | live provider attachments not installed |
| Trading and money | OK | no broker or payment execution path |
| Windows host | OK | Windows-focused service and attachment tests |
| Script operations | OK | static checks and full suite |
| Web service | OK | attachment authentication and origin tests |
| Everything else | OK | local audit scope |

**Not checked**
- tests/lint/build skipped (--no-tests) — no baseline to prove fixes against
- Live provider capture, live enforcement, and external browser/desktop attachment behavior. Tests were skipped because the confirmed live profile has no explicit paper/fake environment variable.

**Leads:** 84 of 84 scanner leads triaged: 0 became findings, 20 dismissed with a reason, 64 unconfirmed; 0 accepted risks suppressed; 4 test-only hits in test files skipped at the source. Each dismissal and its reason: [LEADS.md](LEADS.md).

**Assumptions** (each decides something):
- Runs on mixed (confirmed) — from Windows scheduled task or service setup (profiles/background-job.md:21); decides which host checks apply
- Not connected to real money (confirmed) — from no live markers; decides whether tests may run, and severity
- This audit runs on a development machine, not the live host (confirmed) — from default until the owner confirms; decides whether anything may be installed

**Challenge pass:** Rechecked the highest-risk local paths after remediation: admission rejects invalid allowance/reserve values, service shutdown persists stopped state, and attachment writes use unique temporary files. The remaining blockers require external provider evidence rather than a local code change.

## Baseline
| Check | Command | Result |
|---|---|---|
| — | — | not run |
