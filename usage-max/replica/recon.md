# Usage Max clean-room recon (2026-10-15)

This is a behavioral reconstruction from public documentation, public source, the
local Usage Max installation, and the user's own authenticated local files. No
private source, proprietary asset, or third-party credential was copied.

## What the working competitors do

| Source | Strong behavior worth adopting | Boundary / warning |
|---|---|---|
| [cctop](https://github.com/ryanirl/cctop) | One normalized snapshot for Claude and Codex; explicit source/freshness; local history plus read-only provider reads; token refresh delegated to the official CLI; doctor and JSON output. | macOS-only and provider response formats are version-internal. |
| [cc-usage](https://github.com/ZhuoQiuMcgill/cc-usage) | Separate provider fetchers, defensive normalization, stale-last-good retention, Codex app-server auth delegation, tests for fetch failure and parser drift. | Python/TUI implementation; its direct OAuth usage read is optional and must never log tokens. |
| [claude-usage-dashboard](https://github.com/physcom/claude-usage-dashboard) | Local dashboard and SQLite history preserve useful trends after transcript cleanup. | Dashboard is a presentation layer, not authoritative quota data. |
| [codex-quota-monitor](https://github.com/codexquotamonitor/codex-quota-monitor) | Browser-side quota read makes web-only surfaces observable. | Authenticated browser endpoint is not a stable public contract; keep it optional and local. |
| [chatgpt-usage-tracker](https://github.com/vjymisal0/chatgpt-usage-tracker) | Local-only browser capture and model-specific accounting. | Static quotas are estimates, not provider truth; never present them as live limits. |
| [ai-usage-monitor](https://github.com/AlexandreDor/ai-usage-monitor) | Durable local history, alerts, migrations and anomaly analysis. | More useful as an adapter/storage pattern than as a quota authority. |

## Our observed failure modes

1. Claude desktop/Cowork had no live plan source; the plugin explicitly fell back
   to manual calibration.
2. Codex had stable 0.18.0 scripts while the managed plugin was 0.20.1, and an
   old upload marketplace remained enabled. The result looked installed but ran
   mixed versions.
3. Removing the old Codex plugin left four old upload trust records. The old
   cleanup only removed Claude-only trust, so lifecycle repair reported success
   while stale records remained.
4. Status lacked a common provenance model, so “estimate,” “manual,” and
   provider-reported values could be confused by downstream surfaces.

## Design decision

0.21.0 adds a provider collector with normalized captures:

`{ capturedAt, source, rate_limits }`

Claude uses a provider-owned read-only usage request and delegates expired-token
refresh to `claude mcp list`; Codex uses the latest local `rate_limits` event.
Only normalized percentages, reset timestamps, source and capture time persist.
Failures retain the last successful capture and print a warning.

## Sources reviewed

- [Replica Skill](https://github.com/Jakeschincariol/replica-skill)
- [REA](https://github.com/morluto/rea)
- [OpenAI Codex issue: shared/stale quota surfaces](https://github.com/openai/codex/issues/23192)
- [OpenAI Codex issue: missing 5-hour usage window](https://github.com/openai/codex/issues/32840)
- [OpenAI Codex issue: quota depletion reports](https://github.com/openai/codex/issues/41220)

## Expanded 2026-10-15 recon

The first recon pass undercounted the field by treating competitors as counters.
The strongest current designs are evidence systems:

- [AI Usage Tracker](https://github.com/Danielw412/AI-usage-tracker) combines Codex app-server account quota, Claude usage, local session logs, multi-device collectors, historical windows, and an explicit unattributed lane for ChatGPT web, cloud tasks, and other machines.
- [ClaudeCodeUsage](https://github.com/ClaudeCodeUsage/ClaudeCodeUsage) separates tokens, cache mix, model, effort, quota, source, confidence, projects, and provider comparisons; it explicitly labels Codex quota as last-observed rather than live.
- [LLM Usage Dashboard](https://github.com/kollinger/llm-usage-dashboard) adds account registries, multiple Codex homes, change-only quota history, privacy-safe normalized storage, and optional activity/cost adapters across many providers.
- [headroom](https://github.com/domanski-ai/headroom) uses live provider reads, identity binding, reserves, account ranking, and fail-closed routing; it refuses to route with stale or unverifiable capacity.
- [onWatch](https://github.com/colpachi/onwatch) and [AIUsageMonitor](https://github.com/wenovaX/AIUsageMonitor) show the operational value of background collection, notifications, multi-account visibility, and local-only storage.
- OpenAI Codex issue reports document backward reset timestamps, replayed snapshots that look fresh, read/enforcement disagreement, and subagent/fork bookkeeping inflation. These are not just competitor features; they are failure modes Usage-max must detect.

The resulting conclusion is that Usage-max needs a new evidence and reconciliation core before more routing rules or UI polish. See `docs/research-capability-audit.md` and `docs/feature-backlog.md`.

## Blocker-resolution recon

The current rebuild applies the same clean-room method to the remaining
provider gaps:

- REA's evidence-aware investigation pattern is represented by the normalized
  observation ledger, authority/freshness fields, source matrix, compatibility
  doctor, readiness report, and filed evidence documents.
- Replica's recon/architect/build/test/diff sequence is represented by the
  staged plan, contract fixtures, offline suite, static checker, plan audit,
  and explicit residual-gate report.
- The new Streamable HTTP MCP bridge is the safe host-attachment replica: it
  reproduces the useful behavior of a ChatGPT-connected status surface without
  copying private provider APIs or elevating browser observations to quota
  truth.

The unresolved ChatGPT/Cowork allowance gap is therefore classified as a
provider-signal absence, not an implementation omission. Any future producer
must supply a structured, authenticated, fresh provider-owned allowance record
before it can enter the governing lane.
