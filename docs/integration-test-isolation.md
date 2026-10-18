# Integration test isolation

The permission integration tests must not use `plugins/pstack/api.js`. That
production transport invokes ambient `opencode api`, which can select an active
user server. A temporary session directory does not isolate that server's
configuration, credentials, MCP connections, or saved permissions.

## Check resources after every run

Apply this gate to every test, build, benchmark, and integration run, including
success, failure, and timeout. Run the post-run check before a retry, another
run, or a completion claim. A passing command is not a passing resource gate.
These are agent instructions, not an automatic runtime monitor.

Only primary and implementation roles with existing execution permission perform
the checks. Reviewers and investigators verify receipts or ask the primary for
a permitted runner. This procedure grants no new execution or cleanup rights.

### Record the baseline before starting

1. Declare the command and scope. Verify external memory, elapsed-time, and
   process-count limits before launch. Prefer a fresh, bounded run directory and
   serial tests. Missing or unverifiable containment blocks execution. Obtain
   specific approval for any diagnostic with reduced containment, stating its
   remaining limits and risks. Approval does not turn that diagnostic into a
   fully contained PASS. A runner's cgroup does not contain daemon-owned containers.
2. Record the filesystem type and allocated temporary bytes for each fixture
   area. Measure allocated storage, not only apparent file sizes. List exact
   run-owned paths and the pre-run inventory needed to identify new paths.
   Include temporary locations outside the preferred `/tmp/opencode` area.
3. Record owned process identities as PID and start-time pairs, plus their cgroup
   membership where available. Track descendants and newly acquired resources
   during the run. A process name or PID alone does not establish identity.
   If containers are used, record exact IDs, ownership labels, and fixture mounts.
4. Record owned process, cgroup, and any container memory with measurement time
   and coverage.
   Label RSS as RSS and PSS as PSS. RSS includes shared pages, so summed RSS can
   double-count them. Do not add overlapping process, cgroup, container, and
   tmpfs measurements into a purported total. Record host available memory as
   context, never as the sole proof of cleanup.
5. Bound output capture while the command runs, not only after it exits. Verify
   a byte cap for output and a byte and file-count budget for the capture area.
   Stop the owned run or drain and discard excess output with an explicit
   truncation receipt when its cap is reached. Never collect unlimited output
   in a file or an in-memory buffer before truncating it.
6. Declare a small cumulative byte and file-count budget for test logs and
   receipts across runs, including existing retained evidence. Also declare a
   per-run output cap, for example two redacted logs totaling at most 64 KiB.
   Record both budgets and the audit location. If the existing allocation or
   planned capture exceeds the cumulative budget, do not launch another run.
   Resolve the excess without deleting unknown files. Use compact current local
   documentation for the durable audit, not an ever-growing collection of reports
   on tmpfs. Do not copy raw credentials or dump transcripts.

### Close owned operations and compare

1. After the command ends, wait only for a declared bounded interval for owned
   operations to settle, including pending process or container creation and
   remote requests. Silence, a timeout, or a failed stop request is not closure.
2. Verify that every known owned process has ceased by its PID and start time.
   Verify cgroup membership and tracked descendants, not just the runner PID.
   For containers, verify the exact IDs and ownership metadata against the
   baseline and acquisition records. Confirm that no owned container remains
   and that no pending acquisition can create one later. A denied query or
   unavailable daemon is not an empty inventory.
3. Only after proven quiescence, remove exact run-owned fixtures if authorized.
   Never sweep temporary directories, use `killall`, restart shared servers,
   or delete ledgers, real worker artifacts, global data, or session data.
   Cleanup authorization covers only the named fixtures, not their neighbors.
4. Compare allocated temporary bytes and exact paths with the baseline. Confirm
   fixture removal and list every new or remaining path. On tmpfs, files consume
   memory outside process RSS and can outlive all test processes. A process
   memory limit or zero remaining processes does not prove those bytes are gone.
5. Recheck process and cgroup memory, relevant container coverage, and host
   available memory. Explain observed changes and measurement gaps. Shared-host
   activity and caches can change aggregate memory without an owned leak.
   Distinguish unattributed aggregate growth from evidence of an owned leak.
   Do not impose an arbitrary unchanged-RAM threshold or claim that a flat
   baseline guarantees no memory leak.

### Record the receipt and enforce the result

Keep a compact receipt in the declared audit location. Include:

- The command, outcome, timeout or failure details, verified external limits,
  output-capture limits, and any truncation or cap-exceeded event.
- Before and after allocated temporary bytes, filesystem types, exact fixture
  paths, and all new or remaining paths.
- Remaining owned process and container counts, with identity-verification
  evidence and the status of pending operations.
- Before and after memory observations, RSS or PSS labels, cgroup coverage,
  tmpfs accounting, host context, and any observation gaps.
- Every retained artifact's path, reason, allocated size, and file count,
  compared with both the per-run and cumulative byte and count budgets.
- A resource-gate result of PASS, FAIL, or INCONCLUSIVE, separate from the
  command's outcome.

PASS requires verified external containment and output limits, verified operation
closure, no remaining owned processes or containers, and no unexplained fixture
or memory growth. Only predeclared,
necessary evidence within the small retention budget may remain. State the
observation scope. PASS is not an absolute guarantee about host memory.

Missing containment, exceeded output or cumulative budgets, unexplained growth,
live producers, and leftover fixtures block the next run
and any completion claim. Missing baselines, permission-denied observations,
and uncertain pending remote operations make the gate INCONCLUSIVE. Confirmed
violations make it FAIL. Both results mean stop and escalate with the evidence.
Retain failure fixtures when safe cleanup cannot be proven, but record their
size and resolve the blocked gate. Retention is not an unlimited exception.
Investigate the smallest case after resolving the gate or obtaining specific
authorization for a bounded diagnostic. Do not rerun the full suite to see
whether the leftovers disappear.

## Integration entry points

The integration entry points are:

- `tests/worker-permissions.test.js` uses OpenCode permission evaluation and Docker execution.
- `tests/worker-review-permissions.test.js` exercises the installed permission API through a synthetic plugin. It does not prove native production `worker_review` behavior.
- `tests/portability.test.js` loads the copied bundle in a separate installation.
- `tests/worker-lifecycle-native.test.js` exercises worker stop against an owned
  server with queued input and retained shell history, without model generation.
- `scripts/check_permissions.py` launches the isolated Node permission checker.
- `tests/container.test.js` and the gated Docker case in `tests/worker-artifacts.test.js` use Docker without a shared OpenCode server.

`scripts/check_runtime.py` probes the OpenCode version but does not call its API.
The remaining runtime and history unit tests use injected transports or fixture
executables rather than the shared server.

## Resource boundaries

`tests/helpers/isolated-opencode.js` owns a loopback server, private HOME and XDG
directories, temporary authentication, and direct HTTP requests. The server must
report the spawned PID before tests create sessions. Personal credentials and
environment overrides must not be copied into the fixture. Optional MCPs remain
disabled. Each loaded location checks configuration provenance and the installed
MCP inventory. No model calls are needed for these tests.

`tests/helpers/owned-container.js` records the exact container identity before
startup. Cleanup checks the name and both ownership labels, removes only the
matching container ID, and then removes mounted fixture directories. A Docker
error is not evidence that a container is absent.
Cleanup waits for in-flight startup calls and rejects new acquisitions once
teardown begins. Docker tests also use private CLI configuration instead of
inherited Docker contexts or connection overrides.

Private configuration prevents accidental inheritance. It is not a filesystem
sandbox against malicious installed code. The production shared-server transport
is unchanged and is not validated by direct HTTP permission tests.

## Failure limits

### Temporary files also consume memory

On hosts where `/tmp` is tmpfs, retained fixture files consume memory after test
processes exit. Process shutdown and a passing suite do not prove filesystem
cleanup. A per-run cgroup limit does not bound files accumulated across runs.

On 2026-10-18, 230 leaked review-test clones occupied about 3.78 GiB in
`/tmp/opencode`. The review suite cloned the repository 23 times per execution
without removing the clones. The user authorized cleanup. Exact fixture paths
were checked against their source, Git state, known synthetic file contents,
process references, and mount references before removal. Runtime worker outputs,
session data, and evidence logs were excluded.

Fixture teardown must remove its own files after owned operations settle. Keep
fixtures when resource cleanup cannot be confirmed, and report that retention.
Register teardown immediately after allocation so setup failures do not leak
directories. Verification must compare fixture paths before and after repeated
runs, not only check exit status or process memory.

### Abrupt termination

Normal exception cleanup cannot survive a killed test runner or a machine crash.
Run integration validation in an external resource supervisor. On Linux with a
working user systemd manager, a bounded invocation can use:

```sh
systemd-run --user --wait --pipe \
  -p MemoryMax=2G -p MemorySwapMax=0 -p RuntimeMaxSec=300s \
  -p TasksMax=256 -p KillMode=control-group \
  --working-directory="$PWD" \
  /usr/bin/env PATH="$PATH" PSTACK_CONTAINER_TEST=1 PSTACK_REVIEW_PERMISSION_TEST=1 \
  PSTACK_PORTABILITY_TEST=1 \
  node --test --test-concurrency=1 tests/*.test.js
```

The cgroup bounds the test runner and its subprocesses. Docker-daemon-owned
containers are outside that cgroup and have separate limits in
`plugins/pstack/containers.js`. A daemon outage or a delayed create operation can
leave cleanup unresolved. Inspect exact owned identities after abnormal runs.
Never use broad container pruning, process-name killing, or shared-server
restarts as test cleanup.

The historical memory crash is not attributed to pstack or an MCP by these
tests. The confirmed defect is that earlier permission tests could use the
shared server and inherit its location configuration without owning its cleanup.

## Local validation on 2026-10-17

Two sequential full Node runs enabled all three integration flags. Each passed
115 tests and skipped 11 Bun-dependent bootstrap tests, with no failures. Bun
was unavailable on the test PATH. Both used a 2 GiB cgroup
ceiling, no swap, a 300-second deadline, and one test file at a time. Reported
cgroup peaks were 563 MiB and 573.8 MiB. Those peaks exclude Docker containers,
which have their own 4 GiB limits. These are containment measurements, not a
before-and-after performance comparison.

The permission checker passed all 76 real decisions on two runs. Static contract
and TypeScript checks passed, as did the ten Python tests. Lifecycle regressions
covered startup failure, wrong server identity, assertion failure, pending
request cancellation, signal-resistant descendants, and cleanup racing a real
Docker startup. The installed-server contamination test supplied synthetic
ambient MCP configuration and credentials, then checked that neither was loaded.
After the final success-fixture cleanup change, all seven lifecycle and installed
contamination checks passed again under the same memory ceiling.

All three pre-existing OpenCode PID and start-time pairs remained unchanged.
No additional OpenCode process remained after either full run. Exact Docker
container inventories matched the initial inventory, including after failed
validation runs. No pre-existing container was removed.
The six long-lived shared-server descendants also retained their original PID
and start-time pairs. Snapshot shell and `ps` processes were excluded from that
comparison.

Concurrent sessions remained active, so their RSS was not constant. Across the
validation window, the three pre-existing OpenCode processes changed from
246.7 to 239.3 MiB, 538.8 to 599.4 MiB, and 201.1 to 229.4 MiB. These samples do
not establish the cause of that variation or of the earlier machine crash.

The first validations exposed a cold-start agent-discovery race, an obsolete
artifact fixture filename, and a fixture copy that rewrote symlink targets.
The tests now wait for agent readiness, use the existing agent filename, and
preserve symlink bytes. The assertions remain in place. The original unsafe
shared-server suites were not run.

Local command logs and before-and-after process inventories are retained under
`/tmp/opencode/pstack-isolation-validation/`. Ordinary test hooks still do not
provide the crash guarantees of the external supervisor.
