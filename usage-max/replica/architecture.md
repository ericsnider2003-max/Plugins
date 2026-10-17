# 0.21.0 architecture

```text
Claude Code status line ─┐
Claude provider read ────┼─> provider-limits.mjs ─> normalized local capture
Codex rollout events ────┘                              │
                                                       ├─> Claude limits.json
                                                       ├─> ~/.usage-max/provider-limits.json
                                                       └─> doctor/status consumers
```

The collector is deliberately local and fail-open. Provider adapters are
replaceable; presentation and budget decisions consume normalized captures, not
provider-specific payloads. Credentials never enter the cache, logs, JSON output,
or error messages.

## Freshness rules

- `capturedAt` is mandatory for a live capture.
- A failed refresh does not erase the last good capture.
- `source` is displayed so an estimate cannot masquerade as provider truth.
- Codex local events remain authoritative until a future official app-server
  adapter is proven against the installed CLI.

## Lifecycle repair

Codex cleanup now removes trust tables belonging to an upload/local Usage Max
name when its plugin table is gone. It still preserves trust for an installed
plugin and never rewrites unrelated TOML tables.
