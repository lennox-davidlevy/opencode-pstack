# pstack parity and maintenance

## What maps to what

| Upstream capability | OpenCode implementation | Boundary |
| --- | --- | --- |
| Skill routing and playbooks | Native skills, pstack IDs, shared runtime host contract | 54 upstream skills plus runtime guide |
| Task and AskQuestion | Native subagent and question tools | Primary coordinates; children do not recurse |
| Cursor transcript mining | history_list/history_read | Exact working-directory scope; paginate explicitly |
| `/loop` and audit heartbeats | Durable loop tool | Approved run count/expiry; running server/location required |
| Concurrent isolated work | Host-authenticated sessions with offline containers; optional host worktrees | Explicit committed ref; excludes dirty parent changes |
| Cloud agents | Local workers only | No cloud provisioning or VM isolation |
| CLI/TUI controls | Owned interactive PTY bridge | Unix/Python 3; raw ANSI output rather than screenshots |
| Web UI controls | Playwright MCP | Chrome required; not an IDE/mobile driver |
| Source investigations | poteto-investigator with approved MCP queries | Each private source needs real connection/authentication |
| Bugbot | Inspect actual forge comments; independent local review | Hosted Bugbot generation is not implemented |
| Model role choices | Native agent models and discovered overrides | No translation of Cursor slugs; one model is not a diverse panel |
| Comment Sicko | poteto-reviewer comment critique | Reports first; no automatic suppression deletion |
| Orchestration ledger / PR watcher | Bundled Bun scripts | Inspect side effects; forge auth and deps required |
| Worktree cleanup | Read-only local Git inventory plus worker/session evidence | Every row requires review; standalone clones need separate owner inventory |
| Shipping | Verified local handoff | No commits/pushes; external writes separately gated |
| Bot UI / webhook wakeups | Not installed | Requires an authorized external endpoint and bot service |

## Runtime implementation

Role definitions live in `agents/*.md`, including frontmatter permissions and
models. Root `.opencode/agents -> ../agents` enables development discovery with
one source of truth. Installed as a project's `.opencode/` bundle, the same files
are discovered normally. Shared config retains default selection and built-in
disables, not duplicate role prompts. Relative links never point into user config.

`plugins/pstack/index.js` registers tools using `@opencode/plugin` 2.0.31.
The compatibility target is OpenCode 2.0.32. SDK 2.0.31 is deliberately retained
as part of that tested combination, not upgraded with the runtime prerequisite.
API access not exposed by that plugin version uses fixed, bounded calls through
the authenticated `opencode api` CLI. Tools never accept arbitrary API paths.
The CLI must target the same service as the plugin; explicit remote/standalone
server deployments need matching CLI connection configuration and are not part
of the validated shared-local-service setup.

History verifies target directories, rejects foreign cursors, and returns real
message pages rather than synthesized summaries. It never reads the database.
Worker discovery is owner-scoped. `worker list` pages through this directory's
records; filtered pages can be empty with a continuation cursor. `worker messages`
provides paginated receipts without requiring a running container. A different
coordinator still cannot take ownership; recovery through transfer remains open.

Schedules are namespaced by canonical directory in plugin storage. Operations
serialize in one runtime. Dispatch is durably marked before admission. After an
uncertain dispatch or transport failure, the job pauses and requires inspection;
it is not retried automatically. Permission is rechecked before each wakeup.
Cancelling cannot retract a prompt already admitted to the session inbox.
Expiry and run limits bound the job. Reload resumes armed jobs without replaying
missed intervals. Loading the same integration in multiple independent servers
sharing a database is not supported.

Workers start from a verified commit, use a separate local Git worktree, receive
the current pstack configuration, and carry parent session permissions/model.
Their record is owned by the spawning session. Inspect/stop requires that owner.
Startup failures retain worktrees for inspection, never delete them implicitly.
Local bootstrap copies the authoritative Markdown files and carries restrictions
on the created session. It refuses an existing `.opencode` directory or symlink
rather than replacing checkout configuration. This includes checkouts of this
bundle itself once its development discovery directory is committed. Use the
container backend or a separately designed configuration handoff for that case.
The runtime does not merge output. Local-backend checkouts share host access;
the default container backend uses a standalone clone, isolated command tool,
and a separate host control directory. Model requests reuse the host account;
execution containers receive no credentials and have no network. See
[container architecture](../container/README.md) for exact isolation boundaries.

Terminal tools launch executable argv without shell interpolation. PTY handles
are owned by one session. Start/input require permission; output is bounded per
read and indicates truncation. Closing or unloading ends the bridge and its
process group. Terminals do not survive server restart. Browser control stays
with Playwright rather than introducing another browser implementation.

## Source updates

`vendor/pstack/provenance.json` records the original revision, version, and
source hashes. `vendor/pstack/LICENSE` preserves the MIT notice.
`scripts/import_pstack.py` is a first-import tool, not an overwrite/update command.
For upgrades, import in a separate staging checkout and review changes. Preserve
the native setup/help replacements, plan-template and validator changes, runtime
skill, and shared host contract. Run `python3 scripts/sync_contract.py` after
editing the shared contract; the check command rejects stale generated prefaces.

The removed original skill collection includes its own product-specific tests.
Those owners and callers were removed together. Runtime and plan tests remain;
the old permission sweep was replaced by one for the four pstack roles.

## Validation

Run `npm run check`, `npm test`, and `python3 scripts/check_permissions.py`.
After building the execution image, run `PSTACK_CONTAINER_TEST=1 npm test` to
exercise Docker isolation and the installed OpenCode permission evaluator.
The latter test registers the real worker executor with a registration adapter;
permission decisions and container/file effects are real, not simulated.
The permission check requests decisions without executing the listed actions.
The PTY test drives a real process. Schedule tests verify persistence across a
new scheduler instance, serialized delivery, run caps, cancellation, expiry,
and uncertainty recovery. History tests reject cross-directory access.
Manifest-only review passed independent code review and two native reads on
2.0.32. Production denial and saved-allow edge cases are not yet verified natively.

`PSTACK_PORTABILITY_TEST=1 node --test tests/portability.test.js` boots its own
2.0.32 server with clean HOME/XDG paths and an allowlisted environment. It verifies
server PID and config-source paths, both installation layouts plus generated
local-worker configuration, all four Markdown roles, 55 pstack skills, plugin
activation and selected permission decisions. No provider credentials or global
configuration are copied. The test reuses installed dependencies and explicitly
disables optional MCPs, so installation downloads and authenticated execution
remain outside its coverage. It stops only its owned process and retains logs
with the generated server password redacted. It does not resolve the CLI transport
coupling described above or prove every runtime operation on a separate server.

For live smoke checks, use a separate poteto session and explicitly authorize
only its bounded local operations. Verify tool receipts, not the agent's summary:

1. Load runtime/mode skills and list/read a local session. Try a different
   directory's session and confirm rejection.
2. Start a harmless interactive Python program, send input, read its response,
   resize, and close the PTY.
3. Schedule one short wakeup with a harmless reply-only prompt. Confirm its
   receipt and terminal `done` state, then test a cancelled schedule stays silent.
4. Start a read-only worker at HEAD, verify its actual directory differs, inspect
   its result, and stop it if still active. Retain the worktree for user-approved
   cleanup. Do not create a commit as test setup.

The authenticated container smoke was exercised on V2.0.31: a host worker session
used Astra via the existing provider connection, executed container_command,
reported `/workspace`, and wrote `SHARED_AUTH_OK` in its clone. Status and stop
were exercised, and both initial smoke containers were confirmed exited. No
provider credentials were exported and no container login was performed.

API/SDK references: [plugins](https://opencode.ai/v2/docs/build/plugins),
[configuration](https://opencode.ai/v2/docs/config),
[skills](https://opencode.ai/v2/docs/skills), and
[API](https://opencode.ai/v2/docs/api). Installed package types and the running
server's OpenAPI document take precedence over guesses about experimental APIs.
