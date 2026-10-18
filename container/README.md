# Local container execution

Worker **sessions and model requests run on your existing OpenCode server**.
Your normal `/connect` OpenAI account is reused, including OAuth refresh. No
provider key, OAuth token, database, host home, or Docker socket is mounted into
the execution container. No additional login is required.

The compatibility target is OpenCode 2.0.32 with `@opencode/plugin` SDK 2.0.31
deliberately retained as the tested combination. The authenticated container smoke
recorded in the [parity status](../docs/pstack-port.md) ran on OpenCode 2.0.31.
Production cross-session review has not yet been verified on OpenCode 2.0.32.

Build the execution image (nothing is pushed):

```sh
docker build -f container/Dockerfile -t opencode-pstack-worker:0.1.0 .
```

The default engine is Docker. Optionally configure `container.engine` (`docker`
or `podman`) and `container.image` in the runtime plugin options. Images must
already exist locally. Credential environment settings are no longer used.

`worker start` defaults to `backend: container`. It checks out the requested
commit into a standalone clone. The host session uses a separate empty control
directory, so repository configuration and plugins are not loaded on the host.
Its only model tool is `container_command`, running at `/workspace` inside the
container. File reads/edits and tests use shell/Python through that tool.
Native host tools, Code Mode, MCP, delegation, and history tools are unavailable.
Host global plugins remain trusted server administration, not sandboxed code.

The optional `task` selects a model from the bundle's `pstack-models.json`.
Without it, the worker uses its role's default task. The runtime checks that
the model and variant are available before creating a checkout or container.
This does not change the role's permissions or the parent session's model.
See [model policy](../docs/model-policy.md) for the task choices.

Containers have no network, no capabilities, a read-only root, temporary /tmp,
and CPU/memory/PID limits. Only the clone is mounted; reviewer/investigator
workspaces are read-only. Reviewer commands ask permission. Implementation
commands recheck the owning parent's current agent and session shell permissions.
Compound/ambiguous shell syntax requires separate script approval before execution;
this is conservative permission gating, not a shell-code security proof. Commands time
out after 60 seconds; transport aborts stop the container. Ordinary process
failures return exit status. Host server permission prompts still apply.

Status returns real host-session messages and container state. Stop interrupts
the session and stops its owned container. Completed sessions retain their
container and clone for inspection; use stop when finished. Removal/pruning is
never automatic. Container isolation is not a VM security boundary.

After stopping an owned container, `worker manifest` captures a metadata-only
handoff record. It describes tracked/untracked output with SHA-256 digests and
explicit ignored/index-only coverage, without following symlinks or exporting
contents. A stable artifact digest binds a review to that observation; tests
still require separate receipts. Recapture before handoff and reject changed
output. This is not an immutable snapshot or automatic merge. Nonstandard Git
config, submodules, special/unsupported paths, SHA-256 Git repositories, and
oversized repositories fail closed. Current limits are returned in the manifest.

Offline containers cannot install network dependencies or use private MCPs.
Provide a prebuilt dependency image when needed; no silent network fallback.
Models remain online through the authenticated host server. Local worktree
workers remain available explicitly with `backend: local`, without sandboxing.

Validation:

```sh
PSTACK_CONTAINER_TEST=1 node --test tests/container.test.js
```
