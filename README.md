# OpenCode pstack

An OpenCode V2 integration of pstack engineering workflows. **poteto** coordinates
implementation, review, and investigation using native agents and skills. The
runtime adds scoped history, bounded schedules, container workers, artifact
review, and interactive terminals.

## Contents

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Use](#use)
- [Agents](#agents)
- [Verify](#verify)
- [Limits and documentation](#limits-and-documentation)

## Prerequisites

- **OpenCode 2.0.32**. Other versions require validation.
- **Node.js 24+**, npm, Git, and Python 3.
- Linux for the current worker lifecycle. Its server-identity checks require
  Linux `/proc` and matching local namespaces. Other bundle components may work
  on macOS, but worker support there is not implemented. Clean-install
  verification has run on Linux.
- An OpenCode provider connection with access to the configured model.
- **Docker CLI**. Container workers also need a running daemon and worker image.

Project-local `pstack-models.json` defines six task profiles. Coordination and
implementation use `openai/gpt-6.1-sol#high`. Review uses
`openai/gpt-6-astra#high`. See the [model policy](docs/model-policy.md) for the
other profiles and agent defaults. The tested plugin SDK is 2.0.31.

Optional browser workflows need Chrome for Playwright. Bundled orchestration
scripts need Bun and explicit dependency setup. Forge workflows also need
authenticated `gh` access.

## Install

From your target project, install the bundle into `.opencode/`. If that directory
already exists, merge deliberately instead of overwriting it.

```sh
git clone https://github.com/lennox-davidlevy/opencode-pstack.git .opencode
cd .opencode
npm ci --ignore-scripts
python3 scripts/check_runtime.py
docker build -f container/Dockerfile -t opencode-pstack-worker:0.1.0 .
cd ..
```

Skip the image build if you will not use container workers. The prerequisite
checker checks CLI versions, not Docker readiness or provider authentication.
Installation does not change global configuration or copy credentials.

## Use

Start OpenCode from your target project:

```sh
opencode run --agent poteto --model openai/gpt-6.1-sol#high "Your task"
```

For existing sessions, select `poteto` and the desired model explicitly.
Use `@pstack-poteto-help` for workflows and `@pstack-setup-pstack` for model setup.
Policy edits do not switch the current session's selected model.

For an attended first task, ask poteto to inspect a small subsystem, propose a
local change, and verify it with an independent reviewer. Keep commits, pushes,
and external writes outside that task. Native delegates can work on the current
uncommitted files. Container workers cannot.

## Agents

Native Markdown definitions live in `agents/`, with model, mode, and permissions
in frontmatter:

| Agent | Role | Default task |
| --- | --- | --- |
| `poteto` | Primary coordinator | `coordination` |
| `poteto-agent` | Bounded implementation | `implementation` |
| `poteto-reviewer` | Read-only review | `review` |
| `poteto-investigator` | Connected-source investigation | `investigation` |

Use `@pstack-setup-pstack` to change the project policy after discovering exact
model IDs and variants. From the bundle root, synchronize and check defaults:

```sh
node scripts/sync_models.mjs
node scripts/sync_models.mjs --check
```

Native delegates pass the chosen task's exact model to `subagent`. Workers accept
optional `task` and default by role. Neither route changes role permissions or
forces the parent model. Panels use distinct implementation and review models.

Shared settings live in `opencode.json`. For development in this repository,
`.opencode/agents → ../agents` enables discovery without duplicate definitions.
Preserve that relative symlink. OpenCode still merges applicable global settings.

## Verify

Run from the bundle directory:

```sh
npm run check
npm test
python3 scripts/check_permissions.py
PSTACK_PORTABILITY_TEST=1 node --test tests/portability.test.js
```

`npm test` runs test files serially. This limits test-process fan-out, not total
memory. Installed-server and container checks remain opt-in. For memory-sensitive
validation, also impose a process-group memory limit and a deadline.

OpenCode integration tests and the permission checker use test-owned servers,
private configuration and credentials, and disabled MCPs. They make no model
calls. The permission checker creates only isolated sessions and does not execute
tested actions. Use `PSTACK_CONTAINER_TEST=1 npm test` for container integration
checks. `PSTACK_REVIEW_PERMISSION_TEST=1` enables the installed review-permission
prerequisite test.

See [integration test isolation](docs/integration-test-isolation.md) for bounded
runs, ownership checks, and cleanup limits after crashes.

## Limits and documentation

For a new reviewer or agent taking over this work, start with the
[project architecture and handoff](docs/project-handoff.md). It records the
upstream origin, current implementation, memory incident, portability goals,
verification limits, and unfinished work.

- Full upstream parity is unfinished. Hosted Bugbot, cloud workers, and desktop
  or mobile drivers are not included.
- Container execution is offline and starts from a committed ref. Uncommitted
  parent changes are excluded. Model requests use the host's existing sign-in.
- Worker lifecycle transport pins a validated local server registration for each
  operation. Common tool preflight, worker-start parent lookup, and ordinary
  history tools still use the ambient OpenCode CLI service.
- Local worker hardening has passed bounded integration checks. Do not use
  unattended workers yet. See [recovery boundaries](docs/worker-recovery.md) and the
  [verification record](docs/parity-execution.md).
- Schedules retain at most 100 jobs per project namespace and allow 20 armed
  jobs. Cancelled jobs still count toward retention. Invalid or oversized history
  disables scheduling without disabling worker management. Automatic pruning is
  not implemented.
- Agents do not commit or push. External writes and destructive actions require
  specific approval.

See the [portability and parity guide](docs/pstack-port.md),
[container setup](container/README.md), and [work plan](docs/parity-plan.md).
The upstream MIT license and import provenance are preserved in [vendor/pstack](vendor/pstack/).
