# Integration test isolation

The permission integration tests must not use `plugins/pstack/api.js`. That
production transport invokes ambient `opencode api`, which can select an active
user server. A temporary session directory does not isolate that server's
configuration, credentials, MCP connections, or saved permissions.

The integration entry points are:

- `tests/worker-permissions.test.js` uses OpenCode permission evaluation and Docker execution.
- `tests/worker-review-permissions.test.js` exercises the installed permission API through a synthetic plugin. It does not prove native production `worker_review` behavior.
- `tests/portability.test.js` loads the copied bundle in a separate installation.
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

Normal exception cleanup cannot survive a killed test runner or a machine crash.
Run integration validation in an external resource supervisor. On Linux with a
working user systemd manager, a bounded invocation can use:

```sh
systemd-run --user --wait --pipe \
  -p MemoryMax=2G -p MemorySwapMax=0 -p RuntimeMaxSec=300s \
  -p TasksMax=256 -p KillMode=control-group \
  --working-directory="$PWD" \
  /usr/bin/env PSTACK_CONTAINER_TEST=1 PSTACK_REVIEW_PERMISSION_TEST=1 \
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
