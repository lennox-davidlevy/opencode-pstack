# Project handoff for a new review session

## Status and scope of this snapshot

This document explains the local OpenCode pstack port as inspected on 2026-10-18.
It is a reference for a new reviewer or implementation coordinator, not authority
to resume execution. The accepted milestone is bounded local runtime hardening.
Full upstream workflow parity and unattended-worker readiness remain unfinished.

The work described here includes an uncommitted local candidate. The primary
inspected Git state while preparing this handoff. HEAD was
`aaee8d0b5e32aa6eb879be1837ee935d0ead26c5`, dated 2026-10-17. Modified and untracked
files include model-policy, role, runtime, workflow, documentation, and test work.
HEAD alone does not identify the reviewed candidate. A clone of the advertised
GitHub repository is not proof that it contains this working-tree state. Existing
dirty and untracked work must remain intact. A patch containing only tracked-file
diffs would omit new runtime modules, tests, and documents.

This handoff uses local source inspection and recorded evidence. Its documentation
checks do not independently revalidate the historical runtime receipts below.
No application tests, builds, benchmarks, servers, worker-generation requests,
history queries, installation, cleanup, commits, or pushes ran for this document.
No current GitHub content was fetched. This documentation task adds this file and
updates the README link and its platform and transport caveats.

## Reading order and source precedence

The useful reading order is:

1. [README](../README.md) for the product, installation contract, and advertised limits.
2. [AGENTS](../AGENTS.md) and [integration test isolation](integration-test-isolation.md)
   for the mandatory resource gate before any execution.
3. [Current acceptance gate](parity-execution.md#current-acceptance-gate) and
   [verified hardening milestone](parity-execution.md#verified-local-hardening-milestone)
   for the latest accepted scope and its subsequent fixture-cleanup correction.
4. [Worker recovery boundaries](worker-recovery.md) for uncertainty, ownership,
   retained artifacts, and capacity accounting.
5. [Runtime skill](../skills/pstack-runtime/SKILL.md),
   [mode contract](../skills/pstack-poteto-mode/SKILL.md), and
   [model policy](model-policy.md) for the host procedures and task selection.
6. [Port guide](pstack-port.md), [parity plan](parity-plan.md), and
   [container architecture](../container/README.md) for design history and remaining work.
7. The source map below for the actual implementation of a disputed claim.

Current code determines executable behavior. Current user constraints and role
permissions determine authority. The resource procedure is canonical in
`docs/integration-test-isolation.md`. Historical receipts establish only the
artifact, configuration, and scope that they exercised.

Root `AGENTS.md` exists locally but is excluded by `.gitignore`. A fresh clone
does not receive that local file. The resource gate also lives in the role files,
shared contract, and canonical documentation, so portable instructions must not
depend on the local `AGENTS.md` alone. Changing its tracked status is a separate
packaging decision, not part of this handoff.

The parity documents are cumulative logs, not uniformly current specifications.
Earlier paragraphs can say that a now-accepted unit is pending or unsupported.
In particular:

- The port guide's general description of `opencode api` transport predates the
  pinned worker transport. Worker lifecycle requests and retained worker messages
  now use `worker-transport.js`. Ordinary history and wakeups still use `api.js`.
- The container README's statement that production cross-session review is not
  verified on 2.0.32 is stale for the successful manifest-only read path. Native
  denial and repeated-approval cases remain incomplete.
- The parity plan retains older 2.0.31 compatibility and proposed message-review
  designs. The current runtime target is 2.0.32, and cross-session review exposes
  manifests only. The approved bounded-operation contract supersedes the proposed
  nonprompting release-time revocation requirement.
- Early test counts are intermediate checkpoints, not additional full suites at
  the final artifact. Later corrections invalidate blanket acceptance of earlier
  counts. The latest fixture correction is newer than the 314-test full run.

## Origin and purpose

The upstream project is pstack in [cursor/plugins](https://github.com/cursor/plugins).
Local [import provenance](../vendor/pstack/provenance.json) records version
`0.15.25` at revision `101b274dd991f694e1f7024be2157e5f3adf07de`.
Its recorded source is
[the pinned upstream pstack directory](https://github.com/cursor/plugins/tree/101b274dd991f694e1f7024be2157e5f3adf07de/pstack).
The provenance file contains imported-file SHA-256 values. The upstream MIT
notice remains in [vendor/pstack/LICENSE](../vendor/pstack/LICENSE).

The port repository advertised by the local README is
[lennox-davidlevy/opencode-pstack](https://github.com/lennox-davidlevy/opencode-pstack).
These links identify the recorded origin and advertised destination. They are
not evidence of a fresh remote comparison or publication of the local candidate.

The port brings pstack's engineering skills and playbooks into OpenCode V2.
`poteto` coordinates bounded implementation, investigation, and independent
review. Native roles and skills handle the workflow. A plugin supplies scoped
history, durable bounded wakeups, isolated execution workers, artifact review,
and interactive terminals.

The parity goal is an executed OpenCode workflow for each upstream capability,
or a named external dependency and stop condition. Naming a dependency is not
feature parity. A compatibility preface, registered tool, passing unit suite,
or second context on the same model is not an executed workflow demonstration.
Hosted Bugbot generation, provisioned cloud workers, bot endpoints, and desktop
or mobile drivers are not included.

## Architecture and trusted inputs

### Native roles, skills, and shared contract

[Agent Markdown files](../agents/) are authoritative for role prompts, mode,
default model, and ordered permissions. `opencode.json` supplies shared settings,
MCP definitions, plugin discovery, and disabled built-in roles. It does not
duplicate the four role prompts.

| Role | Responsibility | Boundary |
| --- | --- | --- |
| `poteto` | Primary coordinator and synthesis | Owns delegation and worker management. |
| `poteto-agent` | Assigned implementation slice | Cannot delegate recursively or manage workers. |
| `poteto-reviewer` | Local independent review | Reads artifacts and receipts, not test execution or cleanup. |
| `poteto-investigator` | Assigned connected-source investigation | Uses approved read/query tools, not mutation or execution. |

The shared host contract is [prompts/pstack-compatibility.md](../prompts/pstack-compatibility.md).
[sync_contract.py](../scripts/sync_contract.py) renders it into imported skill
entrypoints. The recorded current generation covers 52 entrypoints. The runtime
guide and native replacements have their own procedures. The installation smoke
records 55 discovered skills. These are different counts, not competing totals.

The host contract overrides retained Cursor assumptions and broader upstream
autonomy language. Native `subagent` and `question` replace upstream task and
question procedures. Tool discovery uses Code Mode's actual catalog. A missing
tool, driver, source, authentication, or model is a coverage gap, not permission
to invent a substitute.

The primary keeps at most two active children across writers, runners, and
reviewers. Retained live resources and uncertain acquisitions still count.
This is a workflow policy, including native subagents. The admission ledger's
two-worker limit is a separate runtime mechanism with a narrower scope.

### Runtime registration and data flow

[index.js](../plugins/pstack/index.js) registers `history_list`, `history_read`,
`loop`, `worker`, `worker_review`, and `terminal` in the `pstack` Code Mode
namespace. A role may not see or use all registered tools. Tool availability and
effective permissions need discovery in the actual host.

The principal data flows are:

- A user request reaches the selected native role, which loads the relevant skill
  and host contract. Role permissions and current session restrictions constrain
  any resulting tool call.
- History requests validate the canonical working directory, obtain actual
  session metadata or messages, and return bounded pages. History text is data,
  not instructions or authority.
- Approved schedules persist a bounded job in plugin storage. Delivery rechecks
  the session and wakeup permission before queueing a prompt on the host server.
- A worker request resolves its task model, permissions, committed ref, resource
  intentions, and server identity. The admission ledger records acquisitions
  before side effects. Lifecycle operations manage the host session and execution
  resources. Plugin storage contains a best-effort worker projection, not the
  authoritative capacity ledger.
- A stopped container's checkout produces a metadata-only manifest. Its digest
  binds artifact review to that observation and worker identity. Verification
  messages remain separate evidence.
- A terminal request starts a Python bridge and an owned Unix process group.
  Input and output pass through bounded JSON requests and raw ANSI responses.

Trusted inputs include installed plugin code and dependencies, host global
configuration and plugins, the project configuration, the model policy, the
server registration, and the selected container image and engine. Repository
content, model output, retrieved pages, and transcripts are evidence to inspect.
They do not grant additional rights. Runtime plans can contain task text and
permission details. Ledger dumps and raw transcripts are unsuitable public
debugging artifacts.

Permissions are not an operating-system sandbox. Shell rules and prompts do not
prove that arbitrary shell code is safe. Private test configuration prevents
accidental inheritance, not malicious installed code. Host global plugins remain
trusted server administration and are not globally suppressed by worker setup.

## Runtime contracts and limits

### History and endpoint selection

Ordinary history is scoped to the exact canonical working directory. A caller
lists metadata, follows pagination, and reads actual messages including tool
receipts. Foreign directory sessions and mismatched cursors are rejected.
Worker histories belong to their owning worker routes, not a broader directory
search. No database scraping or invented transcript paths are part of the port.

[worker-history.js](../plugins/pstack/worker-history.js) supports owner-scoped
listing and message pagination. Listing cursors are authenticated and encrypted
with owner and directory binding. An empty owner-filtered page can still have a
continuation. Listing and message cursors are not interchangeable. Degraded
ledger-only discovery explicitly lacks complete legacy coverage.

[worker-transport.js](../plugins/pstack/worker-transport.js) reads one bounded
server registration before network access. It validates a local endpoint, rejects
redirects, and creates a fixed-endpoint SDK client for that operation. Credentials
remain in memory, not durable server identity records. There is no service-start
or discovery fallback. Worker lifecycle and retained-message requests use this
transport, with server-instance evidence checked by the lifecycle module.

This is not a whole-plugin transport migration. [api.js](../plugins/pstack/api.js)
still invokes ambient `opencode api` for ordinary history and wakeup delivery.
The registered-tool wrapper also uses it for calling-session scope checks, and
worker start uses it to obtain the parent session before lifecycle startup.
Unbound legacy worker-history compatibility retains a limited ambient path.
Consequently, the pinned lifecycle transport must not be described as eliminating
all ambient CLI coupling. Remote or forwarded server arrangements are not a
validated replacement for the supported local registration.

### Durable schedules

Schedules are namespaced by canonical project directory in plugin storage and
owned by the scheduling session. Creation requires approval and bounded interval,
run count, expiry, and prompt. A durable job survives reload, but execution still
requires the OpenCode server and location plugin to be active. Missed ticks do
not replay in a burst.

[loops.js](../plugins/pstack/loops.js) coalesces maintenance. The registered runtime
uses a completion-driven one-shot timer rather than accumulating interval
callbacks. Dispatch is recorded before admission. Uncertain delivery pauses the
job instead of retrying it. Cancellation dominates stale snapshots and recovery.
Late outcomes retain provenance so an older producer cannot replace a newer
receipt. Cancellation does not retract a prompt already admitted to the inbox.

The namespace allows 100 retained jobs and 20 armed jobs. Cancelled jobs still
count. Job records have a 64 KiB JSON limit. Invalid or oversized history
quarantines scheduling without disabling worker management. No automatic pruning
exists. Storage scanning precedes record validation, so these checks are not a
byte-bounded deserialization guarantee. Serialization is local to a runtime,
not cross-process compare-and-swap. Independent servers sharing the same database
are unsupported. Unload waits at most one second for scheduler drain, without
claiming to preempt already admitted operations.

### Worker acquisition, ownership, and recovery

The default ledger is bundle-local `.pstack-state/admission`. Participating
locations must share the same canonical directory and matching limits. Defaults
allow two charged workers and 100 retained records. The ledger does not bound
native subagents, unrelated installations, global plugins, Docker as a whole,
or total host memory.

[admission.js](../plugins/pstack/admission.js) records lifecycle states, separate
location, worktree, session, and container resources, immutable execution inputs,
creation-completion tokens, and cleanup/read producers. The important distinction
is between files retained after verified stop and resources whose creation or
execution might still continue. Uncertainty keeps capacity charged.

A cancelled client request or absent container is not proof that a remote creator
cannot resume. Stop uses the authoritative server instance, cancels the identified
queued input, interrupts the session, stops the exact owned container when present,
and evicts only the dedicated worker location. History and checkout files remain.
Release requires terminal resource evidence and no outstanding producer.

Legacy workers block new starts until explicitly reconciled. Automatic legacy
import, stale-lock recovery, ownership transfer, and direct-ledger recovery tools
are not implemented. A new coordinator does not inherit another session's workers.
A changed server process does not certify old execution closure. Deleting a lock,
record, clone, session, or admission directory is not a supported capacity reset.

### Three execution routes

| Route | Inputs and execution | Isolation and limitations |
| --- | --- | --- |
| Native subagent | Current project, including uncommitted files | Host execution under its role. Disjoint file ownership or serialization is required. |
| Default container worker | Explicit verified committed ref in a standalone clone | Model session and authentication stay on the host. Only `container_command` executes files and checks in an offline container. Dirty parent changes are excluded. |
| Explicit `backend: local` worker | Committed ref in a detached host worktree | No process sandbox. Host resources and credentials remain accessible within effective permissions. |

Container workers use a separate empty host control directory. The child has no
native host file tools, MCP, Code Mode, history tools, or recursive delegation.
The execution container receives no provider credentials, host home, database,
or Docker socket. Model requests still use the host's online provider connection.
An offline execution container does not imply an offline model.

[containers.js](../plugins/pstack/containers.js) configures no network, dropped
capabilities, no privilege escalation, a read-only root, and a writable clone.
Reviewer and investigator clones are mounted read-only. Current engine arguments
set 4 GiB memory, two CPUs, 256 PIDs, and a 1 GiB temporary mount. Commands have
bounded execution and output. Container identity checks use full IDs and both
ownership labels. Containers are not VM isolation.

A completed model turn does not stop its container. Explicit stop remains
required. Artifacts and stopped containers are retained for inspection, not
automatically merged or pruned. Offline dependencies require a prepared image,
not a silent network fallback.

[local-worker-bootstrap.js](../plugins/pstack/local-worker-bootstrap.js) copies
authoritative Markdown roles and retains session restrictions. Its generated
configuration omits the bundled parent runtime and disables bundled MCP servers,
snapshots, LSP, and formatters. It does not disable arbitrary inherited global
plugins or services. Bootstrap refuses an existing `.opencode` directory or
symlink rather than replacing project configuration. This can exclude a committed
development checkout of this bundle from the local backend's supported layout.

### Artifact-bound review

[worker-artifacts.js](../plugins/pstack/worker-artifacts.js) observes an owned,
stopped container worker. The manifest binds worker, session, role, directory,
base, and output identity to sorted path, type, mode, and content digests. It
describes tracked changes and deletions, nonignored untracked output, index-only
differences, and ignored exclusions. Symlink target bytes are hashed without
following the target or returning it. Git integrity checks protect baseline
consumption. Unsupported Git configuration, submodules, special files, paths,
hard links, and oversized captures fail closed. Local workers are unsupported.

Two matching observations detect observed drift. They do not make the checkout
immutable against another host writer. The manifest is metadata, not file export,
test success, automatic merge, or ownership transfer. A changed digest invalidates
acceptance of the earlier observation. Packed-object corruption lacks direct
regression coverage in the recorded artifact work.

[worker-review.js](../plugins/pstack/worker-review.js) permits manifest-only
cross-session review by a primary in the same project. The caller supplies a
worker ID, expected owner, and current artifact digest from an authorized handoff.
An immutable request tuple binds those inputs to the requester, project, and
operation. Fresh approval precedes foreign worker lookup, followed by identity,
digest, requester, and stopped-container checks.

Approval admits that one bounded read to completion. Later permission changes
may not cancel it. There is no atomic release-time revocation guarantee, durable
grant, foreign message access, file content access, discovery right, stop right,
or execution custody transfer. Successful native reads and synthetic permission
tests do not exhaust native denial and saved-allow composition cases.

### Interactive terminal closure

[terminal.js](../plugins/pstack/terminal.js) and [pty.py](../plugins/pstack/pty.py)
own a Unix PTY bridge and process group. Start uses executable argv without shell
interpolation. Start and input require permission. Handles belong to one session,
and reads return raw ANSI text with truncation information rather than screenshots.

Runtime admission rechecks the eight-terminal capacity after permission waits.
Close awaits confirmed bridge closure rather than merely ending input. Startup
abort and closure timeout preserve uncertainty and the initiating error. Group
cleanup covers descendants even when the group leader has already exited.
Unload attempts independent closure of owned PTYs. Terminals do not survive a
server restart, and a failed closure is not a successful cleanup receipt.

## Models and authority

[pstack-models.json](../pstack-models.json) is the project-local source of truth.
The six approved tasks currently map as follows:

| Task | Exact policy value |
| --- | --- |
| `coordination` | `openai/gpt-6.1-sol#high` |
| `implementation` | `openai/gpt-6.1-sol#high` |
| `hard` | `openai/gpt-6.1-sol#xhigh` |
| `investigation` | `openai/gpt-6.1-sol#medium` |
| `review` | `openai/gpt-6-astra#high` |
| `mechanical` | `openai/gpt-5.3-codex-spark#high` |

Native delegation explicitly passes the selected task's exact `model`. Workers
accept optional `task` and otherwise resolve the role default. Neither route
forces the parent's model or changes role permissions. `hard` is an explicit
escalation. `mechanical` is a bounded trial, not a quality or cost guarantee.
Unavailable or rejected policy models are gaps, not permission for a fallback.

Implementation and review provide distinct model IDs, not provider diversity.
Variants or fresh contexts on one model do not constitute model diversity.
Policy setup synchronizes Markdown defaults through `scripts/sync_models.mjs`.
It does not change an active session's selected model. Only the human changes
that selection. Recorded routing tests establish configuration and request
shapes, not comparative model quality or authenticated generation on every model.

## Installation and portability

The root package is private ESM version `0.1.0`. Its direct runtime packages
`@opencode/client`, `@opencode/plugin`, and `@opencode/schema` are pinned to
`2.0.31`. TypeScript is `5.9.3`, and `@types/node` is `24.10.1`.
The tested OpenCode executable is `2.0.32`. The SDK pin is deliberately different.

The README requires Node.js 24+, npm, Git, Python 3, and Docker CLI. Workers need
a ready engine and locally built image. Browser workflows need Chrome. The local
Playwright MCP configuration pins `@playwright/mcp@0.0.81`. Context7 is a configured
remote MCP. Presence in configuration is not proof of service readiness or access.
The image uses `node:24-bookworm-slim` and apt packages without immutable image
or package digests, so the build is not fully reproducible from version pins alone.

There are two role-discovery layouts:

- A consuming project installs the bundle as its `.opencode/` directory. Existing
  configuration needs a deliberate merge, not overwrite.
- Development runs from this repository root. `.opencode/agents -> ../agents`
  exposes the same authoritative role files. The relative symlink is part of the
  candidate and must retain its target and file type when copied.

The clean-install smoke used a separate owned server, fresh HOME and XDG paths,
allowlisted environment, empty credentials, PID verification, and fixture-local
configuration provenance. It covered both layouts and generated local-worker
configuration. It reused installed dependencies through an explicit link and
disabled optional MCPs through a test overlay. It made no model calls. This proves
neither fresh downloads nor authentication, MCP readiness, global-configuration
suppression in normal use, or all runtime operations against an arbitrary server.

The README now distinguishes Linux worker support from possible portability of
other bundle components. Clean-install verification is Linux only. Current
worker server-instance corroboration in
`worker-lifecycle.js` requires Linux `/proc`, matching namespaces, UID, process
start and boot identity, and listener evidence. The implementation explicitly
rejects non-Linux worker server identity. macOS worker support is unimplemented,
not merely an untested equivalent of the Linux path.
Windows is not a validated target. Docker is the tested engine. Optional Podman
configuration does not establish equivalent runtime verification.

Bundled orchestration and watcher tools have a separate Bun dependency setup in
`skills/pstack-poteto-mode/scripts`. Commander is pinned to `14.0.0`, while the
nested development dependencies include `latest` declarations. Normal entrypoints
check freshness and fail rather than installing. Only explicit `bootstrap.ts
--install` installs dependencies and writes its marker, without replaying another
command. Historical bootstrap tests used a fake installer and cached Commander
14.0.2. The nested suite and typecheck were not fully established with all intended
dependencies. A recorded `gh` invocation is not successful remote retrieval.
Watcher target owner and repository must be explicit for nested bundle layouts.
`orch status` still writes its documented local report.

## Memory incident and fixture correction

### Confirmed findings and unknown cause

The confirmed leak was retained temporary storage, not an attributed provider,
OpenCode, or MCP heap leak. This host's `/tmp` is tmpfs, so fixture files consume
memory after every test process exits. A cgroup process limit does not bound
temporary bytes accumulated by repeated runs.

The review fixture used `git clone --no-hardlinks` 23 times per execution without
removing those clones. The recorded inventory found 230 clones occupying about
3.78 GiB. User-authorized cleanup removed those exact clones and 625 other
positively source-attributed old synthetic fixture roots. The total was 855.
The recorded `/tmp/opencode` allocation fell from about 3.81 GiB to 10.7 MiB.
Runtime workers, real session data, uncertain fixtures, and unrelated project
files were excluded. No shared server restart or session deletion was part of
that cleanup.

The operator's handoff also reports a 575.6 MiB cgroup peak. That is historical
scope-limited evidence, not a new measurement here or a global memory bound.
The isolation document separately records earlier peaks of 563 MiB and 573.8 MiB.
These readings exclude daemon-owned Docker containers and do not account for all
retained tmpfs files across runs. They cannot establish the cause of the earlier
machine crash. The crash remains unattributed. Other user-reported RAM figures
were not measured or causally verified in this documentation task.

### Seven fixture files and the final terminal correction

The accepted cleanup unit covers these files:

- [worker-review.test.js](../tests/worker-review.test.js).
- [runtime.test.js](../tests/runtime.test.js).
- [runtime-timer.test.js](../tests/runtime-timer.test.js).
- [container-lifecycle.test.js](../tests/container-lifecycle.test.js).
- [terminal-lifecycle.test.js](../tests/terminal-lifecycle.test.js).
- [local-worker-bootstrap.test.js](../tests/local-worker-bootstrap.test.js).
- [bootstrap.test.js](../tests/bootstrap.test.js).

The correction registers teardown soon after allocation, including setup-failure
paths. Fixtures track pending operations, release holds, drain operations, and
close resources before removing their own directories. Uncertain closure retains
the fixture and reports failure instead of deleting evidence under a live producer.
Cleanup hooks still cannot survive SIGKILL or a machine crash.

Terminal fixtures distinguish `.spawned` bridge identity from `.started` request
markers. A bridge can exist before it handles a request. Review found that proof
for an earlier, already stopped PID could incorrectly reconcile another pending
startup. The final correction checks the exact unresolved error, a known owned
PID, and closure of all `.spawned` bridges before clearing uncertainty. A regression
rejects wrong-PID reconciliation while the later bridge remains alive. This is
fixture-specific proof, not a replacement for the canonical PID and start-time
resource gate.

## Verification evidence and its limits

All results in this table are historical. No row is a fresh test receipt for
this document. Independent reviews refer to the recorded runtime and fixture
units, not independent review of this handoff file.

| Evidence | Recorded result | What it does not establish |
| --- | --- | --- |
| Stable hardening suite before the final fixture correction | 314 Node tests passed with all integration flags, no skips, serial files, 2 GiB cgroup, no swap, 300-second deadline, about 89 seconds. | Full parity, unattended readiness, or temporary-file cleanup. |
| Python and permission validation | Ten Python tests and 76 permission decisions passed in prior receipts. TypeScript, model synchronization, contracts, and whitespace checks also passed. | Fresh results now, execution of the permission-tested actions, or all native authorization compositions. |
| Fixture correction | All 98 affected tests passed twice under a 1 GiB limit with zero new retained fixture directories. | A rerun of the entire integration suite at the final fixture artifact. |
| Final all-bridge correction | All nine terminal tests passed twice with zero new retained fixture directories. | Survival of abrupt termination or global leak freedom. |
| Owned native worker stop | Queued prompt cancelled, only worker location evicted, retained shell history and checkout preserved, repeat stop accepted. | Running-model interruption or real Docker startup on that route. |
| Worker transport correction | 57 corrected worker checks and a native retained-history read passed after the earlier transport groups. | Elimination of ambient transport elsewhere in the plugin. |
| Container execution | Historical authenticated host-model and offline-container smoke, plus gated isolation and permission tests. | A fresh authenticated run on every current model, or a cloud VM boundary. |
| Manifest-only cross-session review | Successful native read path and independently reviewed route, with synthetic installed-runtime permission tests. | Exhaustive native denial, repeated fresh asks under saved allows, foreign messages, or custody transfer. |
| Portability and task routing | Owned credentialless server checked layouts, role definitions, skills, permissions, and task-model session readback. | Network installation, provider generation, MCP readiness, or macOS lifecycle support. |
| Workflow body migration | Scoped static review of history, authoring, orchestration, shipping, and caller corrections. | Executed end-to-end parity pilots for every workflow. |

An initial failing retained-history reproduction accidentally issued an ambient
CLI message GET and received HTTP 400 before the fixture shadowed that executable.
No write was reported, but that run was not fully isolated. The corrected fixture
and primary verification use owned transport. This incident is evidence against
assuming that a temporary session directory isolates an ambient API client.

The latest resource policy was added after earlier repeated validation runs.
Those runs did not fully apply every requirement of the later gate. Their test
results remain useful within their recorded scope, but cannot be retroactively
certified as fully contained or blanket leak-free results.

Historical raw logs and cleanup manifests live under `/tmp/opencode`, including
the locations named in `parity-execution.md`. They are ephemeral local evidence,
not portable dependencies for understanding this handoff. Their survival has not
been checked here. Repository documentation is the durable summary. Raw logs,
transcripts, credentials, and ledger contents are not copied into this document.

## Mandatory gate for future runs

The gate is now present in `AGENTS.md`, all four role bodies, and the shared
contract rendered into 52 entrypoints. It is instruction policy, not an installed
automatic resource monitor. A permitted primary or implementation runner owns
execution and checks. Read-only roles verify receipts and request missing evidence.

Before every test, build, benchmark, or integration run, the canonical procedure
requires externally verified memory, elapsed-time, and process-count limits.
It also requires bounded live output capture, per-run and cumulative evidence
byte and file-count budgets, filesystem types, allocated temporary bytes, exact
owned paths, and process PID plus start-time identities. Container identity,
mounts, pending acquisitions, and memory coverage need separate accounting.

After success, failure, or timeout, the runner verifies closure of owned producers
and resources. It compares exact paths and allocated bytes, accounts for all
retention, and explains memory changes and observation gaps. A silent process,
failed query, absent runner PID, or elapsed timeout is not proof of closure.
Overlapping RSS, cgroup, container, and tmpfs observations cannot be summed into
a purported total.

The resource result is separate from the command result. PASS requires verified
containment, capture limits, closure, no remaining owned processes or containers,
and no unexplained fixture or memory growth. Only predeclared necessary evidence
within the retention budget may remain. FAIL or INCONCLUSIVE blocks retries,
further runs, and completion claims. Missing evidence means stop and escalate,
not assume clean or rerun the suite to see whether leftovers disappear.

The sample systemd command in the isolation document supplies process containment,
not every required capture and accounting check. Docker-daemon-owned containers
are outside the runner cgroup. The sample alone is not a complete gate receipt.
Cleanup remains limited to exact authorized fixtures after proven quiescence.

## Known gaps and proposed next priorities

These priorities are proposals for the next operator-approved assignment, not
new authorization. The current local hardening acceptance remains narrower than
the parity program's definition of done.

1. Establish a current candidate inventory and a bounded evidence plan without
   modifying dirty work. Reconcile the earlier receipts with the later resource
   gate. Any new run needs its own verified baseline, limits, and PASS receipt.
2. Exercise repeated production worker routes on a separately owned host with
   synthetic inherited-service sentinels and externally enforced budgets. The
   open boundary is global service inheritance and execution lifetime, not merely
   omission of bundled services from generated configuration. Automatic worker
   lifetime limits and cleanup after model completion remain implementation work.
   Test containment alone does not supply those production lifecycle controls.
3. Design operator-led legacy and uncertain-worker reconciliation. Acceptance
   needs evidence that every creator and cleanup producer has settled and cannot
   resume. Direct ledger edits, session deletion, and shared-server restarts are
   not substitutes. Ownership transfer remains a separate design decision.
4. Complete native production review authorization cases, including denial and
   repeated fresh approval despite saved allows. Message review and custody
   transfer need separate contracts if requested. They are not implied by manifest
   access.
5. Inventory each upstream workflow body and run bounded acceptance pilots.
   Prompt migrations and static reviews do not prove orchestration, pickup,
   pause, watcher, shipping, or external-service parity end to end.
6. Resolve supported-platform claims and installation reproducibility. Linux-only
   worker identity proof, inherited configuration, dependency downloads, nested
   Bun tooling, and optional engine behavior need explicit acceptance boundaries.
7. Define retention management and richer workflow model controls without changing
   active sessions. No automatic pruning or cross-server atomic schedule ownership
   is currently implemented.

Operator decisions are required for any external provisioning, credential use
beyond the approved connection, network installation, destructive cleanup,
production access, external writes, or broader implementation scope. Current
constraints prohibit commits, pushes, shared-server changes, global configuration
changes, dialupworld changes, real-session test mutation, and deletion of real
session data. Earlier approval to clean named synthetic fixtures does not approve
another cleanup. A handoff transfers context, not authority.

## Questions for the incoming reviewer

- Does each acceptance claim identify its actual artifact and distinguish source
  inspection, fixture behavior, native dispatch, and authenticated execution?
- Can a delayed creator, stop request, held status read, or changed server instance
  release capacity before all relevant producers are known to have settled?
- Are host model authentication and offline execution clearly separated from
  native delegation and unsandboxed local workers?
- Do inherited plugins or services start despite generated configuration and
  tool denials? Which observation would detect them without touching the shared host?
- Does every new run have bounded output and cumulative retained evidence, along
  with process, container, and allocated tmpfs accounting?
- Are manifest identity, immutable request inputs, authorization scope, and
  mutable checkout observations kept distinct?
- Which workflow claims have only static migration evidence? Which need a real
  connected service and specific approval rather than another local substitute?
- Does a portable install reproduce the candidate independently of personal
  global settings while preserving the development discovery symlink?

## Source map

| Files | Responsibility |
| --- | --- |
| [README.md](../README.md), [opencode.json](../opencode.json), [package.json](../package.json) | Product entrypoint, shared host configuration, dependency pins, and commands. |
| [agents/](../agents/), [pstack-models.json](../pstack-models.json), [sync_models.mjs](../scripts/sync_models.mjs) | Native role authority and synchronized task defaults. |
| [skills/](../skills/), [shared contract](../prompts/pstack-compatibility.md), [sync_contract.py](../scripts/sync_contract.py) | Workflow bodies, principles, host adaptation, and generated-preface consistency. |
| [index.js](../plugins/pstack/index.js) | Runtime registration, project scope, permission gates, maintenance timer, and unload. |
| [api.js](../plugins/pstack/api.js), [wakeup.js](../plugins/pstack/wakeup.js) | Ambient CLI transport, exact-directory history validation, and schedule delivery. |
| [loops.js](../plugins/pstack/loops.js) | Durable jobs, bounded retention, cancellation and late-outcome handling. |
| [admission.js](../plugins/pstack/admission.js), [worker-lifecycle.js](../plugins/pstack/worker-lifecycle.js) | Durable capacity state, acquisition and cleanup fencing, server identity, and lifecycle routes. |
| [worker-transport.js](../plugins/pstack/worker-transport.js), [worker-history.js](../plugins/pstack/worker-history.js) | Pinned worker requests, retained receipts, owner filtering, and cursors. |
| [containers.js](../plugins/pstack/containers.js), [local-worker-bootstrap.js](../plugins/pstack/local-worker-bootstrap.js) | Execution backends, exact container ownership, and minimized local configuration. |
| [worker-artifacts.js](../plugins/pstack/worker-artifacts.js), [worker-review.js](../plugins/pstack/worker-review.js) | Repository observations, artifact digests, and exact approved manifest review. |
| [terminal.js](../plugins/pstack/terminal.js), [pty.py](../plugins/pstack/pty.py) | PTY request transport, confirmed bridge close, and group termination. |
| [models.js](../plugins/pstack/models.js) | Policy parsing, task resolution, and model availability checks. |
| [container/](../container/) | Execution image and isolation documentation. |
| [internal/pstack-worker/index.js](../internal/pstack-worker/index.js) | Host-side container command tool and worker execution permission checks. |
| [tests/](../tests/), [isolated server helper](../tests/helpers/isolated-opencode.js), [temporary directory helper](../tests/helpers/temp.js) | Boundary regressions, gated integrations, owned server setup, and fixture allocation. |
| [check_runtime.py](../scripts/check_runtime.py), [check_permissions.py](../scripts/check_permissions.py), [check_permissions.mjs](../scripts/check_permissions.mjs) | Prerequisite probes and isolated permission decisions. |
| [bundled tools](../skills/pstack-poteto-mode/scripts/) | Bun bootstrap, local orchestration ledger, forge watcher, plan checks, and read-only worktree inventory. |
| [vendor/pstack/](../vendor/pstack/), [import_pstack.py](../scripts/import_pstack.py) | Original provenance, license, and first-import tooling, not an overwrite updater. |
| [parity-execution.md](parity-execution.md), [parity-plan.md](parity-plan.md), [worker-recovery.md](worker-recovery.md) | Acceptance chronology, remaining program, and conservative recovery contract. |

## Glossary

| Term | Meaning in this project |
| --- | --- |
| Host contract | OpenCode-specific workflow rules that override upstream host assumptions. |
| Native delegate | An OpenCode subagent working under its native role in the current project. |
| Worker | An owner-scoped host session with a committed-ref checkout and explicit execution backend. |
| Control location | The separate host directory used by a container worker's model session. |
| Charged worker | A worker whose live or uncertain resources still consume admission capacity. |
| Retained artifact | Files kept after verified stop for inspection, subject to retention limits. |
| Producer | An admitted operation that might still create, read, stop, or otherwise affect resources. |
| Projection | Best-effort worker metadata in plugin storage, distinct from the authoritative ledger. |
| Artifact digest | A binding to worker identity and a particular manifest observation, not test success or an immutable checkout. |
| Manifest review | One freshly approved metadata-only read without messages, file export, or custody transfer. |
| Resource gate | The before-and-after execution evidence procedure, distinct from a passing test command. |
| Local hardening | The accepted bounded runtime work, not full workflow parity or unattended readiness. |
