# Writing slots for REPORT.md
> Write under each heading. `rt report` copies each section into the report; lines starting with `>` are hints and are dropped.
> Never edit REPORT.md by hand: it is regenerated whole every time.

## broken
> What's broken: one or two plain sentences, about 20 words each, in the owner's terms.
The local control plane is hardened and full offline checks pass. Live provider evidence and guarded launch remain unavailable, so production enforcement is not ready.

## cost
> What it could cost: money, customers, data or downtime, with numbers where you have them. 40 words or fewer.
No confirmed open critical or high code defect remains after remediation. Remaining work is external integration and a guarded observation trial.

## need
> The one decision you need from the owner. 30 words or fewer.
Attach fresh provider observations for ChatGPT/Cowork, complete an approved observation trial, and review the rollout gate before enforcement.

## scenarios
> 3–6 cards when a long-running process exists, otherwise up to 6. Format in references/output.md (### title, then What happens · How likely · Would you notice? · How you'd recover today · Fixed by).
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

## areas
> Coverage table | Area | Result | Note |: one row per Gap or Risk area (note 10 words or fewer, cite finding ids), then ONE row listing every OK area.
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

## not_checked
> Anything else you did not examine, by name, or 'nothing else'.
Live provider capture, live enforcement, and external browser/desktop attachment behavior. Tests were skipped because the confirmed live profile has no explicit paper/fake environment variable.

## challenge
> One line: which critical and high findings you tried to disprove, what was downgraded, which two weak areas you re-hunted.
Rechecked the highest-risk local paths after remediation: admission rejects invalid allowance/reserve values, service shutdown persists stopped state, and attachment writes use unique temporary files. The remaining blockers require external provider evidence rather than a local code change.
