# OpenCode pstack parity program

## Definition of done

Every bundled workflow must either have executable OpenCode-native procedures
with recorded verification, or a named external dependency and a clear stop
condition. A compatibility preface, tool registration, or same-model review does
not establish workflow parity. Hosted Cursor services are not silently replaced
by weaker local behavior. No commits, pushes, external writes, provisioning, or
credential transfer are authorized by this plan.

## Workflow

1. Frame the task against the upstream workflow and current executable behavior.
2. Identify the first missing capability and its observable acceptance check.
3. Delegate a bounded implementation with disjoint file ownership.
4. Inspect the diff and independently review the result.
5. Run the behavior check and relevant existing integration tests.
6. Record verified results and remaining gaps here before advancing.

## Completed verification unit: container engineering workflow

The coordinator assigned a new prerequisite CLI and its tests to a container
worker at committed HEAD. The worker used the existing host model connection,
edited only two new files, and ran tests through container_command. Initial
fixture execution failed on the container's noexec /tmp mount. Moving test
fixtures to the writable checkout fixed that without weakening isolation.

Final independent review found no findings. The read-only reviewer initially
could not access the external worker checkout, so the coordinator copied the
already inspected files into this project for review. Byte comparison confirmed
both matched the worker output. This is a manual reviewed handoff, not an
automatic worker merge capability.

Verified on 2026-10-17:

- `python3 scripts/check_runtime.py --json`: all host CLI prerequisites pass.
- `npm run check`: type checks and generated host contracts pass.
- `PSTACK_CONTAINER_TEST=1 npm test`: eight runtime/container tests, one plan
  validator test, and nine prerequisite CLI tests pass.
- `python3 scripts/check_permissions.py`: 72 decisions pass.
- `git diff --check`: passes.
- The checker implementation worker session was interrupted at handoff;
  its owned container was confirmed exited.

The clone and stopped container are retained; cleanup is not implicit. Existing
uncommitted integration work was preserved. Package manifests were accidentally
ignored by the original repository rules; those exclusions are now removed.

## Remaining workstreams

The read-only audit found concrete dependencies in session-pickup, pause-safely,
orchestrate, swarm, autonomous-run, worktree-audit and recall. Local priorities:

1. Replace unsafe cleanup classifications and remove implicit network operations.
2. Add owner-scoped worker listing and paginated receipts. Then design explicitly
   approved ownership transfer; listing alone does not solve cold-start recovery.
3. Bind no-commit handoffs and reviews to output artifacts, not only base SHA.
4. Flatten nested/cloud orchestration into primary-owned bounded work queues.
5. Respect configured delegate models and report actual model diversity.
6. Separate dependency setup from observational watcher commands.

The first two runtime batches are implemented. Recall, pickup and pause bodies
now use native history and ownership procedures, with unsupported transfer
called out explicitly. A current-directory history read recovered the originating
coordinator's report; following its cursor recovered the actual worker-start
receipt. Attempting ordinary history access to the separate worker directory
was rejected. This verifies the underlying recovery/access procedure, not every
agent interpretation of the new prompts. Full prompt scenario validation remains.

### Cleanup and worker-history batch verification

- The local audit never fetches and never labels a row safe. Real Git fixtures
  cover untracked, staged and ignored files, unknown activity, and unusual paths.
- Independent review found configured signature verification could execute an
  external program. A positive-control test against existing signed history
  reproduced the extra invocation before the fix. `--no-show-signature` fixes it;
  the regression passes without creating commits.
- Worker `list` supports owner-filtered empty pages and continuation. Worker
  `messages` supports bounded pagination without restarting stopped containers.
- Independent review found foreign IDs visible inside listing cursors. Cursors
  are now authenticated/encrypted with owner and directory binding. Disclosure
  and forgery regressions fail before the fix and pass after it.
- Live registered tools returned opaque listing cursors and accepted continuation
  across two empty owner-filtered pages. Another owner's message request rejected.
- The first owning-session pagination check timed out and was interrupted.
  A later live retry succeeded through the registered worker tool from owning
  session that owned the checker worker, without restarting its stopped container.
  Page one returned two message records; following cursor.next returned two
  distinct earlier records.
  A further cursor remained. This verifies pagination, not an exhaustive history scan.
- Final `npm run check`, `PSTACK_CONTAINER_TEST=1 npm test`, and `git diff --check`
  passed. The suite now has 21 Node tests, one plan test, and nine checker tests.
- Follow-up static reviews found no remaining blocker in the cursor and signature
  corrections. Reviewers' test execution was permission-blocked; execution results
  above are the primary's own tool receipts.

Next unit: artifact-bound no-commit handoffs, then explicit approved worker
ownership transfer. Do not
begin broad autonomous orchestration before those recovery invariants hold.

### Artifact handoff unit (in progress)

Initial independent review blocked acceptance despite passing repeatability checks.
The implementation did not verify Git object contents against their object IDs,
so a stable corrupted baseline could conceal tracked changes. Its digest-bound
worker identity also omitted the message session, checkout directory and role.
Both findings are now corrected and independently reviewed with no new blocker.
Full Git fsck checks the base, HEAD and index roots before consumption; consumed
blobs also receive direct OID validation. Six loose-object corruption regressions
failed before the correction and pass after it. Session, directory and role now
participate in the digest-bound identity. The primary's full suite passed.
Matching live digests established repeatability only; that live check preceded
the integrity correction. Packed-object corruption is not directly regression
tested, and process bounds are not a memory sandbox. Concurrent host mutation
remains outside the guarantee. The original 32-test report covered four files;
the corrected artifact-only suite has 30 tests, with no removed coverage.

Deliver a read-only manifest for an owned, stopped container worker. Bind the
worker/base identity to sorted path/type/mode/content digests, including tracked
deletions and untracked output. Never follow symlinks into host paths or invoke
Git external diff/verifier programs. Explicitly report ignored-file and submodule
coverage. Compare repeated observations and reject detected changes, without
claiming the checkout is immutable against other host writers. Record message
session identity for separately inspected verification receipts; a manifest alone
does not mean tests passed. No merge, export of file contents, automatic stop,
deletion, commit, ownership transfer, or external writes are part of this unit.

### Recovery design constraints

The independent design review rejects changing `worker.owner` alone. Container
labels are immutable creator provenance, and child tool options still reference
the original coordinator's permission context. A stopped container also does not
prove the child's inbox/execution is quiescent.

The next recovery unit should transfer narrowly approved custody of retired
results, not resume execution. Any implementation must distinguish creator from
current custodian, bind approval to exact identities/revision/artifact digest,
make retries idempotent, prevent stale-owner operations, and preserve history
denials. Cross-instance atomic coordination and admission fencing remain design
prerequisites. The exposed plugin storage interface has get/set/scan but no CAS;
do not claim atomic takeover from a read followed by an unconditional set.

No takeover implementation is authorized to bypass these checks or broaden
history scope. If the runtime cannot establish them, keep transfer unsupported
and use a specifically approved, artifact-bound review handoff instead.

### Cross-session review access unit (design in progress)

Use review-only access rather than changing ownership. Acceptance requires an
explicit, resource-specific permission gate for the requesting primary session,
the exact project/worker/original owner, operation and artifact identity. Denied
requests must expose no worker contents. Approval must not create execution,
stop, merge, cleanup or general history authority. Restrict the initial unit to
stopped container results; revalidate identity and artifact state after approval.

Sequence: review the concrete permission and cursor design; delegate bounded
implementation and behavioral rejection tests; inspect and independently review;
run the existing suite; then exercise the real approval boundary. Do not treat
the user's approval to build this feature as approval for arbitrary foreign
session reads. Durable grants and custody transfer remain out of scope.

Design review proposes `worker review` with caller-supplied expected owner,
artifact digest, operation and bounded pagination. Lookup occurs only after
approval; message output is buffered until final record/lifecycle/digest checks.
Review cursors must be authenticated and scoped to requester, project, worker,
original owner, child session and digest. No discovery of foreign worker metadata.

Implementation is gated on installed-runtime permission proofs. `save: []` does
not itself guarantee fresh approval when an allow rule already matches. The
review route must also preserve both history action and tool-level denials.
An isolated synthetic permission test is underway, with no foreign-history
reads or changes to production/global permissions. If either property cannot
be enforced, this route remains unsupported rather than weakening the boundary.

The host now reports OpenCode 2.0.32. The user approved validating that version
without installation changes. The compatibility pin remains 2.0.31 until the
validation gate passes. A retry hit asynchronous fixture-plugin startup before
permission cases ran; bounded readiness handling is being added.

Independent prototype review requires stronger evidence before production work:
two genuinely concurrent fixture readers rather than only pending permission
records; explicit execution-agent/tool-source context matching production;
runtime-version rejection before fixture mutations; and discrimination between
permission denials and unrelated assertion errors. Apply these after the current
readiness writer completes. Production tests must additionally cover permission
changes while approval waits and exact requester/worker/digest/cursor binding.

The strengthened prerequisite is now verified on 2.0.32. The primary reran all
22 installed-server checks and the full suite (62 Node passes, 10 Python passes;
the opt-in permission test skips in the ordinary suite and ran separately).
Independent review found all four fixture blockers addressed, without claiming
native-dispatch provenance or production review acceptance. Runtime compatibility
promotion to 2.0.32 is underway; the SDK remains 2.0.31, with no install changes.

The first production slice is manifest-only review. It must use trusted native
execution context, a fresh exact-tuple approval, no preapproval foreign lookup,
and postapproval identity/lifecycle/digest and permission-revocation checks.
Messages and review cursors are intentionally deferred to a separate unit.
No owner, execution rights or durable access grants transfer in either slice.

Runtime promotion completed: the checker requires 2.0.32, its nine CLI tests pass,
and the primary's host JSON check reports ok. Documentation distinguishes the
2.0.32 runtime from the retained 2.0.31 SDK; no dependencies were installed.

Manifest-review implementation stopped before any production edits. The public
permission API exposes prompting assertions but no supported non-prompting policy
evaluation for the planned release-time revocation check. Native tool dispatch
also remains unverified. A read-only design review is assessing whether a second
explicit approval is sound or simply moves the same race. Do not silently weaken
the revocation contract, invent an allow exception, or expose review access while
this gate is unresolved. Existing owner-only manifests remain available.

The user subsequently approved the explicit bounded-operation contract: fresh
approval authorizes one exact read to complete; later permission changes may
not cancel it. This supersedes the nonprompt release-revocation requirement,
not the identity, digest, stopped-state or fresh-approval gates. Do not claim
atomic authorization/release or reliable cancellation of an approved operation.
Manifest-only implementation has resumed under that contract. Message access,
ownership transfer and execution rights remain excluded. Every actual foreign
read still needs its own resource-specific approval through the runtime gate.

Manifest-only `worker_review` is now implemented. The primary reran type and
contract checks, 86 Node tests, 10 Python tests, and 76 permission-policy decisions.
The opt-in synthetic permission suite was skipped in that ordinary full run;
its separate 22-check run previously passed. Independent route review found no
blocking code issue. The reviewer did not rerun fixtures or permission checks.

Native dispatch succeeded against the actual stopped checker worker. Its owning
coordinator refreshed the handoff digest, then the primary invoked the registered
`worker_review` permission-gated tool using that exact worker, owner and digest.
The returned digest matched the owner's refreshed artifact digest,
with exactly `scripts/check_runtime.py` and `scripts/test_check_runtime.py` and
container state `exited`. No messages or file contents were requested. This
establishes the real successful dispatch path, not every rejection/race case;
those are covered by boundary tests with fixture permission/container services.

Remaining native acceptance coverage: repeated fresh asks despite configured or
saved allows, preserved denials, and unchanged unrelated permission actions on
the actual production route. Synthetic installed-runtime tests prove the selected
permission mechanism, not all production hook composition. Do not describe this
single successful native read as exhaustive authorization validation. Cross-session
message review and custody/execution transfer remain unimplemented.

## Portable Markdown-agent installation

User requested conventional Markdown roles and clean-install proof before more
parity features. The previous configuration-defined roles were supported by V2,
but current-host prompt equality did not establish independence from the user's
global configuration. Global agent/config symlinks remain untouched.

Acceptance sequence:

1. Move the four role definitions and instructions into `agents/*.md`, preserving
   modes, models and ordered permissions. Remove the JSON role duplicates and
   obsolete prompt files. Keep one authoritative definition per role.
2. Support consuming-project `.opencode/agents` discovery and repository-root
   development without inheriting a global poteto definition.
3. Adapt local-worker bootstrap, which previously copied JSON-defined roles.
4. Remove tests' dependency on a pre-existing `/tmp/opencode` directory.
5. Use a separate owned server and clean HOME/XDG directories to verify both
   layouts, effective agents, skills, plugin registration and permission rules.
   Copy no credentials, run no model inference, and disable optional MCP startup
   only through an explicit smoke-test overlay. Record dependency reuse honestly.
6. Independently review changes, rerun regressions and document the exact install
   contract and exclusions. No commits or global setup changes are authorized.

An uncommitted working-tree candidate is the test artifact. A fresh clone of
current HEAD still lacks the new integration; no test may imply otherwise.

Implemented and primary-verified on Linux/OpenCode 2.0.32:

- Four Markdown roles replace the JSON definitions and four separate prompt
  files. The shared compatibility template remains in `prompts/`.
- Development discovery uses the tracked-candidate relative link
  `.opencode/agents -> ../agents`. During the migration there was a transient
  discovery gap that stopped delegates; the primary completed the migration.
- Before/after live effective profiles matched exactly for all four roles:
  system, model, mode, permissions, description and color.
- A separate owned server with fresh HOME/XDG directories loaded development,
  consuming-project and generated local-worker configurations. Its PID matched
  `/api/info`; all reported config source paths were inside the fixture. All four
  prompts/models/modes, 55 skills, plugin activation and selected permissions
  passed. Its credential inventory was empty before and after. The server stopped.
- The test reused installed dependencies through an explicit node_modules link,
  disabled optional MCPs in the copied configuration, and made no model requests.
  It does not prove downloads, authentication, MCP readiness, or arbitrary runtime
  tool operations against a separate server.
- Local workers copy authoritative Markdown agents; session restrictions remain
  authoritative. Bootstrap refuses existing `.opencode` directories or links
  rather than overwriting them. This stricter supported-layout limit is documented.
- Temporary fixture helpers no longer require `/tmp/opencode` to exist.
- `npm run check`, `PSTACK_CONTAINER_TEST=1 PSTACK_PORTABILITY_TEST=1 npm test`,
  `python3 scripts/check_permissions.py`, and whitespace checks passed: 96 Node
  passes, one opt-in permission integration skipped, 10 Python passes, and 76
  permission decisions. The separate permission integration was not rerun here.
- Global config/agent symlink targets, inode and timestamps remained unchanged.

Independent review found two corrections: model setup still targeted JSON, and
the development smoke synthesized its link instead of testing the shipped one.
Setup now edits authoritative Markdown frontmatter and verifies effective models,
including inherited-model conflicts. The smoke copies the actual discovery link
and verifies that missing/broken-link candidates do not discover the roles. All
six clean-server checks passed. Follow-up review found both corrections addressed
with no new blockers; final full-suite counts above include those regressions.
Reviewers inspected source but did not rerun tests. Tests and config sources
remain uncommitted. No global installation, dependency install, commit or push
occurred.

### Explicit dependency setup unit

Implemented and independently reviewed with no blocking findings. The primary
reran all 11 bootstrap subprocess tests successfully. Normal entrypoints check
freshness before loading Commander; only explicit `--install` installs or writes
the marker, without replaying another command. Shebangs disable auto-install.
Verification is deliberately narrower than full tool readiness: installation
tests use a fake installer, ready fixtures use cached Commander 14.0.2 rather
than pinned 14.0.0, and the nested typecheck/suite remain blocked by missing
dependencies including bun-types. Watcher coverage proves a gh invocation, not
successful remote status retrieval. No real installation was performed.

After the manifest corrections and this batch, the primary's full check passed
62 Node tests and 10 Python tests, with no skips, plus type/contract and whitespace
checks. Independent follow-up review accepted both manifest corrections with no
new blocking defect; reviewers inspected receipts but did not rerun the tests.

Read-only source investigation confirmed both watcher and orchestration CLI
entrypoints bootstrap dependencies before argument parsing. A help/status request
can therefore run `bun install --frozen-lockfile`, mutate caches and the install
marker, and replay the command. Existing CLI tests largely bypass this boundary.

Separate the shared read-only readiness check from a dependency-free explicit
`bootstrap.ts --install` entrypoint. Missing/stale dependencies must fail with
actionable instructions, no installation or replay. Setup needs separate approval
for package/network effects. Test actual entrypoints in isolated fixtures without
network. This does not turn forge status reads into offline operations, and
`orch status` still writes its documented local status report.

- Rewrite Cursor-dependent workflow bodies, not merely their prefaces. Start
  with history/recall and session pickup, then autonomous scheduling and swarm.
- Add reviewed worker result handoff and conflict detection. Current workers
  exclude uncommitted input; current integration was selective/manual.
- Make practical dependency images and bounded permissions usable for normal
  project work. Offline containers remain the default.
- Verify reload/recovery, ownership and cleanup at workflow boundaries.
- Map upstream evidence sources, model diversity, hosted reviewers, and remote
  automation separately. External services require real connections and approval.

These are open workstreams, not a claim that full parity is already achieved.
