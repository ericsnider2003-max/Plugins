# Usage-max Evidence and Workflow Autopilot Design

## Goal

Make Usage-max reliable across changing provider quota windows and add a recommendation-first workflow autopilot that improves completed work per unit of allowance without limiting authorized interactive work.

## Invariants

- Provider observations are facts; transcript-derived values are estimates.
- Multiple provider windows are preserved and named.
- Unknown, stale, malformed, or clock-skewed evidence never authorizes unattended execution.
- Interactive work remains advisory and continues to completion.
- Explicit model choices are preserved unless they exceed the configured safety ceiling.
- Autopilot recommendations never mutate model, account, or task state without an explicit unattended/workflow execution request.
- Every workflow stage is checkpointed and idempotent.

## Design

1. Normalize every Claude observation with a primary compatibility `window` plus a complete `windows` map and evidence diagnostics.
2. Accept additive provider windows; quarantine only conflicting changes to existing window semantics.
3. Select usable weekly evidence from the best valid window and report partial coverage explicitly.
4. Extend admission to evaluate all applicable windows, while requiring `executionMode: unattended` for hard admission decisions.
5. Add a workflow planner that classifies task size/risk, proposes direct or scout-worker-verifier shapes, and records recommendation evidence without enforcing it.
6. Add a workflow ledger with plan, stage, checkpoint, outcome, verification, and measured/estimated usage fields.
7. Add an autopilot CLI in recommendation-only mode plus an explicit `run` path for checkpointed unattended workflows.
8. Add diagnostics for approval state, stale evidence, clock skew, partial windows, and recommendation rationale.

## Safety

The planner is advisory by default. The runner refuses interactive tasks, missing checkpoints, unknown model identity, stale or partial evidence, and non-idempotent stage results. Failures produce a resumable checkpoint and never silently retry side effects.

## Verification

Focused regression tests cover provider window additions, conflicting schema changes, partial Claude evidence, multi-window admission, execution-mode separation, planner recommendations, checkpoint resume, and interactive non-blocking behavior. Existing offline suites remain required.
