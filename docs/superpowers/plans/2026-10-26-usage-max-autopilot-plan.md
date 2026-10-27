# Usage-max Evidence and Workflow Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native implementation in this session).

**Goal:** Correct provider evidence handling and add safe recommendation-first workflow autopilot.

**Architecture:** Preserve the existing observation contract with additive fields, add a dedicated planner/ledger boundary, and keep execution-mode checks at admission and runner boundaries. The planner recommends; only the explicit unattended runner executes.

**Tech Stack:** Node.js ESM, JSON/JSONL local ledgers, existing offline test runner.

**Spec:** `docs/superpowers/specs/2026-10-26-usage-max-autopilot-design.md`

## Global Constraints

- Interactive Usage-max behavior is advisory and must not stop authorized work.
- Unknown or stale provider evidence cannot authorize unattended work.
- No new runtime dependencies.
- Windows-compatible Node.js and PowerShell workflows.
- Existing contracts remain backward compatible.

## Review Focus

- Additive and conflicting provider window changes must produce different outcomes.
- A five-hour-only Claude capture must not be mistaken for a complete weekly allowance.
- Multi-window admission must reject when any applicable window breaches reserve.
- Interactive tasks must never be hard-blocked by autopilot.
- A failed workflow stage must resume from its checkpoint without duplicating effects.

### Task 1: Evidence model and provider schema compatibility

**Files:**
- Modify: `usage-max/scripts/observation-adapters.mjs`
- Modify: `usage-max/scripts/provider-shape.mjs`
- Modify: `usage-max/scripts/usage-check.mjs`
- Modify: `usage-max/scripts/statusline.mjs`
- Test: `usage-max/test/claude-observation-regression.mjs`
- Test: `usage-max/test/provider-shape.mjs`

- [ ] Add tests for `windows`, partial weekly evidence, additive buckets, and conflicting existing buckets.
- [ ] Implement additive compatibility and explicit diagnostics.
- [ ] Run focused tests and the existing provider suite.

### Task 2: Execution-mode-safe admission

**Files:**
- Modify: `usage-max/scripts/admission.mjs`
- Modify: `usage-max/scripts/task-state.mjs`
- Test: `usage-max/test/admission.mjs`

- [ ] Add tests proving interactive admission is advisory and unattended admission evaluates every usable window.
- [ ] Implement explicit execution-mode handling and multi-window reserve checks.
- [ ] Run admission and task-state tests.

### Task 3: Workflow planner and ledger

**Files:**
- Create: `usage-max/scripts/workflow-autopilot.mjs`
- Create: `usage-max/scripts/workflow-ledger.mjs`
- Create: `usage-max/test/workflow-autopilot.mjs`

- [ ] Add deterministic task classification and plan generation.
- [ ] Add append-only idempotent workflow records.
- [ ] Add tests for direct, staged, risky, constrained, and surplus recommendations.

### Task 4: Checkpointed workflow runner and CLI

**Files:**
- Create: `usage-max/scripts/workflow-runner.mjs`
- Modify: `usage-max/scripts/usage-max.mjs`
- Create: `usage-max/test/workflow-runner.mjs`

- [ ] Add explicit unattended-only runner boundary.
- [ ] Add checkpoint/resume and no-duplicate-effect tests.
- [ ] Add `workflow plan`, `workflow status`, and explicit `workflow run` commands.

### Task 5: Diagnostics and full verification

- [ ] Add evidence and workflow fields to the relevant report output.
- [ ] Run focused tests, all offline tests, and static checks.
- [ ] Review the diff for accidental changes to the user’s existing work.
