# Scanner leads and their dispositions

84 leads from the scripted checks. Leads that became findings are in REPORT.md; this file lists the dismissed, unconfirmed and untriaged ones so the report does not have to.

4 test-only analyzer hits inside test files (asserts, fixture passwords, random numbers) were skipped at the source.

## Dismissed · calendar-expiry (1)
- L013 `test/fix.mjs:12` — 67903ba57fc0 dated calendar exists only in test fixture data; production calendar code is not using this fixture

## Dismissed · daily-state-in-memory (1)
- L012 `scripts/rollout.mjs:4` — c9a491e8cffd [TM2] rolloutDecision is pure policy evaluation; durable daily state and kill-switch ownership are supplied by the caller

## Dismissed · db-url-credentials (1)
- L014 `test/fix.mjs:62` (+2 more lines) — a20f25ee9682 embedded database URLs are test fixtures and are never loaded by shipped runtime code

## Dismissed · float-money (1)
- L063 `scripts/reservations.mjs:10` (+1 more lines) — 3bff6b452232 [TM2] reservation values are allowance percentages, not currency amounts; validation bounds them to finite percentages

## Dismissed · javascript.express.security.cors-misconfiguration.cors-misconfiguration (1)
- L045 `scripts/attachment-server.mjs:42` — fb291acbad29 [TM2] CORS reflects an origin only after strict extension-id allowlisting; arbitrary origins receive no CORS header

## Dismissed · javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp (3)
- L023 `codex/scripts/codex-diet.mjs:31` — c60838ce4e3b regex input is escaped before construction and only selects a named local configuration section
- L049 `scripts/cleanup-old.mjs:66` — 4f39543054b9 [TM2] regex input is escaped before construction and derives from local plugin keys, not a request body
- L066 `scripts/safety.mjs:13` — 7d7f41f219f9 [TM2] regex input is escaped before construction and derives from local safety-rule keys

## Dismissed · javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop (1)
- L060 `scripts/owned.mjs:9` — ca9dc3cc120c property paths are internal configuration keys; no untrusted request object is merged into a prototype

## Dismissed · javascript.lang.security.audit.spawn-shell-true.spawn-shell-true (5)
- L003 `codex/scripts/codex-lean.mjs:27` — 5cfe15480bf8 Windows shell is required for the fixed codex command wrapper; arguments are restricted before launch
- L004 `codex/scripts/run-trimmed.mjs:26` — 3d1019e32e17 run-trimmed accepts plain words only and rejects shell metacharacters before the required platform shell
- L006 `scripts/check.mjs:183` — 42251c8848d8 [TM2] Windows shell is required only for the fixed local check command; no user-controlled command string
- L007 `scripts/claude-lean.mjs:22` — 716639d61f03 Windows shell is required to invoke the fixed claude.cmd executable with argument tokens
- L008 `scripts/eval-cache.mjs:74` — 94dccfe4d4fd [TM2] Windows shell is required for fixed command execution; command tokens are validated and cache keys are separate

## Dismissed · javascript.lang.security.detect-child-process.detect-child-process (4)
- L005 `scripts/background.mjs:27` — f3f855696a23 background inspection invokes fixed local OS tools with fixed argument arrays; no user command is forwarded
- L009 `scripts/graphify.mjs:52` — e666e7401b09 graphify receives an internal planned step and runs with shell false and an explicit backend
- L010 `scripts/repository-actions.mjs:7` — 153ca35ca2a8 repository action filenames are confined to the repository and subprocess arguments use shell false
- L011 `scripts/repository-checks.mjs:5` — 7aa84ac5b396 repository check filenames are confined to the repository and subprocess arguments use shell false

## Dismissed · secret-aws (1)
- L002 `test/memory.mjs:142` — d54cdfcaa7b3 intentional fake AWS fixture in tests; no shipped credential

## Dismissed · secret-private-key (1)
- L001 `test/guard.mjs:178` — 0b6151483f1f intentional fake private-key fixture in tests; no shipped credential

## Unconfirmed · bind-all (1)
- L079 `test/mcp-http-server.mjs:5` — became GAP-001

## Unconfirmed · empty-catch (51)
- L015 `browser-adapter/background.js:5` (+3 more lines) — became GAP-001
- L018 `browser-adapter/native-host.mjs:14` — became GAP-001
- L019 `codex/scripts/backup.mjs:15` (+3 more lines) — became GAP-001
- L020 `codex/scripts/codex-app-server.mjs:18` (+1 more lines) — became GAP-001
- L021 `codex/scripts/codex-diagnose.mjs:46` (+1 more lines) — became GAP-001
- L022 `codex/scripts/codex-diet.mjs:16` — became GAP-001
- L024 `codex/scripts/codex-governor.mjs:273` (+2 more lines) — became GAP-001
- L025 `codex/scripts/codex-guards.mjs:7` (+2 more lines) — became GAP-001
- L026 `codex/scripts/codex-hook.mjs:21` (+12 more lines) — became GAP-001
- L027 `codex/scripts/codex-weights.mjs:26` — became GAP-001
- L028 `codex/scripts/notify.mjs:10` — became GAP-001
- L029 `codex/scripts/run-trimmed.mjs:16` (+1 more lines) — became GAP-001
- L030 `codex/scripts/sync.mjs:11` — became GAP-001
- L031 `codex/scripts/trim.mjs:19` (+2 more lines) — became GAP-001
- L032 `codex/scripts/trimcheck.mjs:6` — became GAP-001
- L033 `codex/test/run.mjs:177` — became GAP-001
- L034 `hooks/auto-observe.mjs:4` — became GAP-001
- L035 `hooks/bash-trim.mjs:28` — became GAP-001
- L036 `hooks/cross-gate.mjs:11` (+1 more lines) — became GAP-001
- L037 `hooks/guard.mjs:18` (+2 more lines) — became GAP-001
- L038 `hooks/ledger.mjs:86` (+3 more lines) — became GAP-001
- L039 `hooks/memory.mjs:19` — became GAP-001
- L040 `hooks/notifications.mjs:19` — became GAP-001
- L041 `hooks/session-start.mjs:42` (+4 more lines) — became GAP-001
- L043 `scripts/anomaly.mjs:44` — became GAP-001
- L044 `scripts/attachment-server.mjs:33` (+1 more lines) — became GAP-001
- L046 `scripts/autohandoff.mjs:38` — became GAP-001
- L047 `scripts/build-plugin-zip.mjs:35` — became GAP-001
- L048 `scripts/claude-headless-adapter.mjs:19` — became GAP-001
- L050 `scripts/context-bridge.mjs:48` — became GAP-001
- L051 `scripts/ctxfiles.mjs:33` — became GAP-001
- L053 `scripts/guard.mjs:19` (+5 more lines) — became GAP-001
- L054 `scripts/lib.mjs:99` — became GAP-001
- L055 `scripts/memory-suggest.mjs:78` — became GAP-001
- L056 `scripts/memory.mjs:112` (+3 more lines) — became GAP-001
- L058 `scripts/meter.mjs:18` (+1 more lines) — became GAP-001
- L059 `scripts/offload.mjs:43` — became GAP-001
- L061 `scripts/pack.mjs:19` — became GAP-001
- L062 `scripts/profile.mjs:37` (+1 more lines) — became GAP-001
- L064 `scripts/resume-cli.mjs:12` (+1 more lines) — became GAP-001
- L065 `scripts/resume.mjs:61` (+1 more lines) — became GAP-001
- L067 `scripts/safety.mjs:59` (+2 more lines) — became GAP-001
- L068 `scripts/savings.mjs:55` — became GAP-001
- L069 `scripts/service-runner.mjs:11` (+4 more lines) — became GAP-001
- L070 `scripts/statusline.mjs:45` — became GAP-001
- L071 `scripts/trim.mjs:19` (+2 more lines) — became GAP-001
- L072 `scripts/trimtest.mjs:9` — became GAP-001
- L073 `scripts/unattended-supervisor.mjs:13` — became GAP-001
- L074 `scripts/usage-check.mjs:31` (+1 more lines) — became GAP-001
- L075 `scripts/usage-max.mjs:124` (+5 more lines) — became GAP-001
- L078 `scripts/worker-service.mjs:120` — became GAP-001

## Unconfirmed · float-money (3)
- L042 `scripts/account-activity.mjs:18` — became GAP-001
- L076 `scripts/usage-max.mjs:214` — became GAP-001
- L077 `scripts/worker-loop.mjs:19` — became GAP-001

## Unconfirmed · localhost-url (4)
- L080 `browser-adapter/native-host.mjs:16` — became GAP-001
- L081 `scripts/activation.mjs:20` — became GAP-001
- L082 `scripts/attachment-server.mjs:51` (+1 more lines) — became GAP-001
- L084 `scripts/offload.mjs:11` — became GAP-001

## Unconfirmed · timer-leak (2)
- L016 `browser-adapter/background.js:11` — became GAP-001
- L017 `browser-adapter/content.js:17` — became GAP-001

## Unconfirmed · todo (1)
- L083 `scripts/memory-suggest.mjs:61` — became GAP-001

## Unconfirmed · weak-random-js (2)
- L052 `scripts/guard.mjs:18` — became GAP-001
- L057 `scripts/memory.mjs:213` — became GAP-001
