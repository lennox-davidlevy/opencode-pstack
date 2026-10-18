# Parity execution record

## Current acceptance gate

**2026-10-18 correction.** The previous passing suite did not establish temporary
file cleanup. On this host `/tmp` is tmpfs. Missing review-fixture teardown left
230 repository clones occupying about 3.78 GiB. The user authorized cleanup and
test fixes. Those exact clones and 625 other positively attributed old synthetic
fixtures were removed after ownership, content, activity, and mount checks.
Runtime workers, session data, uncertain fixtures, and unrelated project files
were excluded. Repeated cleanup checks and the final review are recorded below.

The cleanup fix is verified. Seven test files now remove their owned temporary
directories after resource closure. Independent reviews accepted the fixes,
including preservation of terminal fixtures when closure is uncertain. The
primary ran all 98 affected tests twice under a 1 GiB limit. Both runs passed
with zero new retained fixture directories. After the final all-bridge closure
correction, all nine terminal tests passed twice with the same zero-retention
check. TypeScript, model synchronization, generated contracts, and whitespace
checks passed. No full integration suite was rerun for this test-only change.

In total, 855 source-attributed old fixture roots were removed. `/tmp/opencode`
fell from about 3.81 GiB to 10.7 MiB, including remaining evidence and unrelated
files. No shared server was restarted or session deleted. Receipts and exact
cleanup manifests remain under `/tmp/opencode/pstack-*-cleanup-*.json`. Test logs
are `all-fixture-cleanup-{1,2}.log` and `terminal-allclosed-{1,2}.log` under
`/tmp/opencode/pstack-parity-safety`. Successful cleanup does not guarantee
teardown after SIGKILL or prove the cause of the historical machine crash.

The local runtime-hardening milestone passed its stable-artifact suite and scoped
independent reviews. All 314 Node tests and ten Python tests passed. This is not
full upstream parity or approval for unattended workers. Legacy-worker
reconciliation, ownership transfer, richer workflow controls, and external
integrations remain unfinished capabilities.

## Scope and completion gate

The user authorized local implementation on 2026-10-17. Work stays in this
repository. Preserve the pending model-policy changes. Do not commit, push,
alter global configuration, restart the shared server, or modify dialupworld.
External provisioning, credentials, destructive cleanup and external writes
still require specific approval.

Completion means each upstream capability has an implemented and demonstrated
OpenCode workflow, or an explicitly recorded external dependency. A dependency
record is not feature parity. Passing unit tests does not prove live workflows.
The historical machine crash remains unattributed.

## Run checklist

- [x] Read the Principles section of poteto-mode.
- [x] Phase A: Frame. Safety before additional concurrency; existing model work
  remains the baseline. External integrations are approval-gated.
- [x] Phase B: Design the workflow. Execute the units below in order, with
  independently reviewed diffs and bounded checks before accepting each unit.
- [ ] Phase C: Run the loop.
  - [x] Coalesce scheduled maintenance and prove cancellation/backpressure.
  - [x] Bound retained schedule history without disabling worker management.
  - [x] Establish durable worker acquisition ownership and shared admission.
  - [ ] Bound worker service and execution lifetimes; reconcile partial failure.
  - [x] Verify terminal admission after permission waits and confirmed closure.
  - [ ] Exercise repeated production routes in a separately owned host with
    synthetic service sentinels and externally enforced memory/time limits.
  - [ ] Add complete workflow model controls without changing active sessions.
  - [ ] Add approved stopped-worker recovery/transfer and result handoff.
  - [ ] Inventory and port remaining workflow bodies, with runnable acceptance
    checks and explicit dependency gates for each external capability.
- [ ] Phase D: Keep the audit trail. Record each accepted unit below.
- [ ] Phase E: Verify and hand back. Report actual runtime evidence and remaining
  blocked capabilities, never a blanket parity claim from static checks.

## Throughput checkpoint

Limit delegation to two concurrent children initially. The scheduler writer owns
only its module/tests. A read-only reviewer investigates worker lifecycle APIs.
No production worker is started to test an uncontained worker implementation.
The primary owns integration, verification and this record.

## Evidence

The prior model-policy validation is recorded separately in `docs/model-policy.md`.

### Scheduler backlog

The scheduler now shares one pending/running maintenance pass across concurrent
ticks. The implementation delegate reported reproducing 101 scans before the
fix and cancellation delayed behind redundant maintenance. The primary inspected
the diff and reran both scheduler test files under a 1 GiB memory ceiling and
60-second deadline. All 11 tests passed. Receipt is
`/tmp/opencode/pstack-parity-safety/scheduler.log`.

The primary added the reviewer's suggested assertion that cancellation remains
pending during active delivery. All 11 tests passed again under the same limits.
Final receipt is `/tmp/opencode/pstack-parity-safety/scheduler-final.log`.

Independent Astra review found no blockers for preventing redundant maintenance
passes. Its verdict was based on source inspection, not another test run.
Cancellation still waits for the entire active pass, including other jobs.
This unit does not establish worker cleanup, aggregate limits or leak freedom.
The canonical decision log is `/tmp/opencode/pstack-parity-decisions.tsv`.

Follow-up primary inspection found that the interval still calls async `tick()`
and attaches a rejection handler every second while a pass is stalled. Scan
coalescing alone does not bound those pending promise handlers. Timer-level
backpressure remains open and requires a registered-runtime regression.

The follow-up replaces the interval with a completion-driven one-shot timer,
started only after successful registration. The primary inspected the diff and
ran 16 runtime and scheduler tests under a 1 GiB ceiling and 60-second deadline.
The first run exposed a test capturing Node's experimental warning as a pstack
error. Capturing only the pstack diagnostic fixed the test without suppressing
the warning. All 16 then passed. Receipts are `timer-boundary.log` and
`timer-boundary-final.log` under `/tmp/opencode/pstack-parity-safety/`.
Independent follow-up review found no source blocker in timer sequencing.
The reviewer could not obtain a shell diff and did not rerun tests. The primary
inspected the actual diff and ran the checks above. Active operations remain
non-preemptive.

### Worker containment design

Read-only SDK review identified targeted location eviction and caller-supplied
session IDs. It also found that session interrupt uses the `resume` query field,
not a `continue` body field. The primary confirmed the interrupt contract in
the installed protocol. These findings still need runtime acceptance checks.

Two bounded implementation delegates are active on disjoint files. One builds
the durable admission ledger and its filesystem tests. The other hardens container
transport cancellation and stable ownership checks. Neither unit is integrated
or accepted yet. The ledger covers participating locations, not machine-wide
resource use. Uncertain acquisitions must remain charged until reconciled.

### Container transport hardening

The container delegate completed optional signal forwarding, stable full-ID
checks for stop/exec/reinspection, and separately bounded cancellation cleanup.
Cleanup failures retain the initiating error alongside the cleanup error.
The primary inspected the diff and updated two existing fake-engine fixtures
to provide valid IDs and ID-based inspection. The four affected test files passed
66 tests under a 1 GiB ceiling and 120-second deadline, without real Docker calls.
Receipt is `/tmp/opencode/pstack-parity-safety/container-unit.log`.

Independent review found no blocker in ID-based targeting or error aggregation.
It correctly withheld integrated lifecycle acceptance. Callers still need signal
forwarding, durable pre-acquisition records, and preservation of startup plus
cleanup errors. This is not a lifetime bound. Containers still run until stopped,
and uncertain daemon-side startup needs ledger reconciliation.

Local-worker configuration minimization is a separate bounded unit in progress.
It removes bundled parent-only services rather than assuming tool denial prevents
service startup. Global service inheritance remains an explicit acceptance gap.
The primary inspected the diff and adapted installed-layout checks. The test-owned
OpenCode server loaded roles and permissions without the parent runtime in the
local-worker layout. All 13 bootstrap/portability checks passed under a 2 GiB
ceiling and 120-second deadline. No model calls were made. Receipt is
`/tmp/opencode/pstack-parity-safety/worker-config.log`.

Review caught disabled-only MCP definitions that depended on inherited complete
definitions. Direct SDK schema validation reproduced rejection. The primary now
copies every bundled server definition with `disabled: true`, including custom
IDs, and validates the generated configuration without any inherited definitions.
The four unit checks passed; the isolated 13-check suite passed again. Receipts
are `worker-schema-before.log`, `worker-schema-after.log` and
`worker-config-final.log` under `/tmp/opencode/pstack-parity-safety/`.
Independent follow-up review found the schema defect addressed in source.

The primary also verified targeted location eviction on the owned server. Three
cycles removed only worker services, preserved the loaded parent location, and
left projected message history readable without reloading the worker location.
All 14 bootstrap/portability checks passed. Receipt is
`/tmp/opencode/pstack-parity-safety/worker-eviction.log`. This proves the API
boundary, not yet production worker start/stop integration or global canaries.
Follow-up assertions require all expected MCP IDs in the disabled inventory and
successful parent agent/plugin queries after each eviction. The worker history
fixture is empty, so populated-history preservation is not established. All 14
checks passed again in `worker-evidence-final.log` under the same log directory.

### Admission ledger

The ledger delegate delivered a standalone filesystem state machine. The primary
reran all 32 tests under a 1 GiB ceiling and 90-second deadline. Receipt is
`/tmp/opencode/pstack-parity-safety/admission-unit.log`. Independent review is
completed and held integration. Required corrections are a separate host-location
resource, explicit retained artifacts, immutable execution specification, and
outstanding-creator fencing. A delayed creator must not resume after another
caller releases its capacity. A fresh bounded delegate is correcting the ledger
and adding regressions. No runtime capacity limit is enforced yet.

The correction adds durable acquisition completion tokens, a location resource,
explicit retained-artifact states and an immutable execution specification. The
primary found and reproduced a further local-worker rejection: local services
and files share the checkout path. The primary now requires a distinct control
path only for container workers while preserving separate resource accounting.
All 38 admission tests passed under a 1 GiB ceiling and 90-second deadline.
Receipts are `local-location-before.log` and `admission-fenced.log` under
`/tmp/opencode/pstack-parity-safety/`. Independent re-review is pending.

Independent re-review found no additional standalone ledger blocker. Runtime
integration still must leave outstanding attempts charged when client transport
ends before server/daemon work settles. Session interruption alone is not release
evidence. A new bounded delegate is wiring lifecycle operations and the shared
canonical ledger into worker routes, with adapter failure regressions. The primary
added `/.pstack-state/` to `.gitignore` for the proposed local runtime ledger.
No integrated worker cap has been verified yet.

The first lifecycle integration is implemented but failed independent review.
Blockers are unfenced cleanup producers across processes/retries, no authoritative
server-instance binding, projection read failures hiding ledger records, error
bookkeeping masking original failures, and an unbounded scheduler drain during
unload. Two disjoint delegates are correcting lifecycle accounting and shutdown.

The shutdown slice now closes terminals independently and bounds scheduler drain
to one second. Independent source review found no scoped blocker. The primary
reran 20 scheduler/runtime tests under a 1 GiB ceiling and 90-second deadline;
all passed in `/tmp/opencode/pstack-parity-safety/unload-final.log`. This bounds
waiting, not SDK operations already admitted or native PTY process termination.
Primary source inspection also found the terminal-count check occurs before
permission waits, and close reports success before awaiting bridge termination.
These need a bounded follow-up before claiming terminal lifecycle containment.

The retention slice initially passed 21 focused checks under a 1 GiB ceiling.
Receipt is `/tmp/opencode/pstack-parity-safety/schedule-retention.log`.
Independent review held acceptance because legacy overflow prevented unrelated
tool registration, transition metadata could exceed the record bound, and numeric
scheduling semantics were not fully validated. A bounded correction is adding
scheduler-only quarantine, transition-safe record limits, and regressions. No
history is automatically pruned. Storage allocation itself has no byte-limited
scan API, so post-scan validation is not a deserialization memory guarantee.

The primary's full bounded suite passed 215 tests, failed one, and skipped 11.
The failure was the owned-process shutdown test reading `/proc` during process
exit and receiving `ESRCH` rather than `ENOENT`. Both mean the process is absent.
The primary corrected only that assertion and reran its file: six passed, one
opt-in native check skipped. Receipts are `lifecycle-suite.log` and
`isolation-race.log` under `/tmp/opencode/pstack-parity-safety/`.

A new `tests/worker-lifecycle-native.test.js` is prepared to drive production
stop against real queued-input and eviction APIs on the owned credentialless
server. A narrow Unix-socket CLI relay targets only that fixture's allowlisted
routes. Model generation remains disabled through the real prompt API's
`resume: false` fixture setup. Syntax passed; execution awaits the corrected
lifecycle contract. It does not test a running model or real container startup.

### Remaining workflow inventory

A bounded read-only reviewer inspected 19 local files. Its upstream directory
requests were permission-rejected, so this pass does not establish upstream
equivalence. Local operative bodies still use Cursor transcript paths in
automate-me, reflect, show-me-your-work and eval. Authoring instructions in
automate-me and reflect also need project-local OpenCode paths and procedures.
A disjoint writer is correcting only those bodies and three reflect references.
Static migration will not count as an executed workflow pilot.

The seven-file history/authoring edit is complete and under independent review.
The primary inspected the diff, confirmed generated contracts match and ran
whitespace checks. No actual history-backed pilot has run in this unit.
Independent review found no concrete static migration blocker. It inspected the
scoped unstaged diff and all seven active files, but did not run a workflow pilot.

The same inventory found recursive coordinator dispatch in orchestrate, cloud
owners/verifiers in autopilot and shipping, and old loop commands. Those remain
open. Cloud execution, hosted Bugbot and missing desktop/mobile drivers require
real integrations or explicit blocked status, not renamed local substitutes.
A bounded writer is now porting the four orchestration/shipping playbooks and
the reflect synthesizer template. The supported path remains primary-only local
dispatch and verified local handoff. External service requirements stay visible.

Independent review rejected the first orchestration edit. It assigned runtime
checks to a role without those permissions, allowed exceptions to the two-child
ceiling, did not isolate independent-item verification inputs, and left comment
review dispatch ambiguous for nondelegating children. A fresh bounded writer is
correcting those issues plus three conflicting caller playbooks. Runtime execution
must use an appropriately permitted nonauthor runner. Read-only reviewers inspect
the artifact and receipts rather than acquiring broader permissions. Independent
items need stable baseline-plus-item artifacts, not merely disjoint file writers.
No orchestration workflow acceptance is claimed.

Re-review found the four orchestration blockers statically corrected. It then
identified watcher repository inference from the nested bundle clone. The primary
confirmed the actual CLI flags and now requires explicit target owner/repository.
The primary also corrected the store-locking description: mutations lock, queries
do not provide locked snapshots. These remain static checks, not remote pilots.

The primary corrected five ordinary caller playbooks and the mode body to remove
remaining commit, recursive-dispatch and slash-loop instructions. Review then
found the aggregate two-child cap needed to apply before every workflow's fanout.
The cap now lives in the mode's Subagents section and shared host-contract source.
All 52 generated contracts were regenerated and match the source. Retained live
resources and uncertain acquisitions count; files from verified stopped workers
remain subject to separate retention limits.

The user requested quiet execution until local verification is complete. Routine
progress replies stop. External provisioning and destructive actions remain
specific-approval gates. The safe usable local release and full upstream parity
remain separate acceptance milestones.

### Server-target pinning

The cleanup-fencing delegate delivered durable access leases, server-instance
binding, degraded discovery, and error aggregation, with 86 reported focused
passes. It explicitly left one P1 unresolved: CLI discovery can switch targets
inside a bracketed operation. The primary verified the installed native client's
read-only `Service.discover` API and fixed-endpoint client support. A bounded
delegate is replacing worker-management CLI transport with a pinned native client.
No `ensure` or service-start fallback is allowed. Authentication stays in memory.

The primary declared the already-locked `@opencode/client` and `@opencode/schema`
2.0.31 packages as direct dependencies. Manifest and existing lock entries agree.
No package installation, network package fetch, or version upgrade occurred.

The primary exercised production cleanup against an owned credentialless server.
The first invocation could not find the executable in systemd's PATH. A retry
exposed an additional inbox item created by the fixture's shell command. Fixture
setup now cancels those fixture-owned items before admitting the test prompt.
The final native run passed, preserving real shell history and checkout output,
removing the queued prompt, evicting only the worker location, and confirming
idempotent stop without reloading it. Receipt is
`/tmp/opencode/pstack-parity-safety/native-lifecycle-queued.log`. It used a 2 GiB
memory limit and 90-second deadline. This does not prove model interruption or
Docker execution. Independent lifecycle review remains pending.

Five terminal checks passed under a 1 GiB limit and 45-second deadline, including
simultaneous permission release, confirmed bridge exit, and native process-group
cleanup with both live and exited leaders. Receipt is
`/tmp/opencode/pstack-parity-safety/terminal-lifecycle.log`. Independent terminal
review remains pending. TypeScript, whitespace checks and generated contract
freshness also passed at this checkpoint.

The primary reran the corrected scheduler and terminal group. All 58 tests passed
under a 1 GiB ceiling and 90-second deadline in
`/tmp/opencode/pstack-parity-safety/scheduler-fence-final.log`. This includes the
late-completion/reload/cancellation regression. Permanent control records prevent
stale job snapshots from undoing cancellation or recovery. Late outcome evidence
is bounded separately. Review remains pending; the implementation does not claim
cross-process compare-and-swap storage semantics.

Worker core and registered-route groups separately passed 60 and 40 tests under
1 GiB ceilings, before the latest transport/history correction. Receipts are
`worker-core-final.log` and `worker-routes-final.log` in the same evidence directory.
Independent review found no static capacity-release bypass but identified two
transport gaps: retained history still used ambient CLI discovery, and native
discovery performed a redirect-following probe before URL validation. A scoped
correction now owns those gaps and a held-status/stop race regression. The earlier
test counts do not certify that subsequent correction.

The scheduler re-review accepted cancellation dominance but found a receipt-order
bug. A retired producer's late outcome could replace a newer normal producer's
receipt in the effective listing. A bounded correction adds provenance-aware
selection and the mixed-producer regression. Terminal review found no new source
blocker but requested explicit startup-abort and closure-timeout coverage.

Additional primary checks passed while those corrections remained isolated:
10 installed-layout portability checks, 23 fixture-engine lifecycle checks,
and 22 permission checks with one skip. Logs are `portability-final.log`,
`container-regression.log`, and `permissions-final.log`. Permission policy
validation also passed 76 decisions without executing the tested actions.
The isolated-server group passed all seven checks. Supplying the discovered Bun
path also enabled all 11 previously skipped bootstrap checks, which passed.
Receipts are `isolation-final.log` and `bootstrap-bun-final.log`.
The default `npm test` command now runs test files serially to avoid unbounded
file-level fan-out. External memory and time limits remain necessary for bounded
integration runs. The documented systemd command explicitly carries PATH so the
supervised process can find the intended installed tools.

The transport correction now validates a single bounded registration snapshot
before network access. It no longer calls the native discovery helper whose
first probe follows redirects. The SDK client remains the request transport.
Retained worker history uses that same pinned endpoint without loading the worker
location. The primary's 57 corrected worker checks passed, followed by a native
cleanup check that reads retained history through the production lifecycle method.
Receipts are `corrected-worker-routes.log` and `native-retained-message.log`.

The delegate reported a containment mistake in its initial failing history repro.
An ambient CLI message GET returned HTTP 400 before the fixture shadowed that
executable. No write was reported, but that run was not fully isolated. The
corrected test uses an owned CLI fixture, and the primary's native verification
uses only its owned server registration.

## Verified local hardening milestone

Independent final reviews accepted the receipt-provenance fix, terminal boundary
tests, worker transport and history routing, and corrected fixture isolation.
The primary ran the complete stable Node suite with all integration flags and Bun
available. All 314 tests passed with no skips or failures. The run used a 2 GiB
cgroup limit, no swap, a 300-second deadline, and serial test files. It finished
in 89 seconds. Receipt is
`/tmp/opencode/pstack-parity-safety/complete-stable-suite.log`.

The ten Python tests, TypeScript, model synchronization, shared-contract freshness,
and whitespace checks passed afterward. The supervised test unit is inactive
with no remaining control group. A read-only Docker inventory found only exited
pstack-labelled containers from earlier runs. Those retained containers were not
removed. No commit, push, global configuration change, or shared-server restart
was performed.

Test Behavior, Not Implementation drove direct assertions on retained history,
request destinations, cancellation, and process closure. Prove It Works required
the primary's complete rerun instead of relying on delegate reports.

This accepts the bounded local changes, not the unfinished items in the checklist.
Container model completion still requires explicit stop. Global host plugins are
not sandboxed by the generated worker configuration. Unknown remote settlement
keeps capacity charged, and no automatic legacy reconciliation or ownership
transfer is provided. The historical crash remains unattributed.
