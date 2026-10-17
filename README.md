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
- Linux or macOS. Clean-install verification has run on Linux.
- An OpenCode provider connection with access to the configured model.
- **Docker CLI**. Container workers also need a running daemon and worker image.

All four agents default to `openai/gpt-6-astra#high`. Change their Markdown
frontmatter to use another available model. The tested plugin SDK is 2.0.31.

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
opencode run --agent poteto --model openai/gpt-6-astra#high "Your task"
```

For existing sessions, select `poteto` and the desired model explicitly.
Use `@pstack-poteto-help` for workflows and `@pstack-setup-pstack` for model setup.

## Agents

Native Markdown definitions live in `agents/`, with model, mode, and permissions
in frontmatter:

| Agent | Role |
| --- | --- |
| `poteto` | Primary coordinator |
| `poteto-agent` | Bounded implementation |
| `poteto-reviewer` | Read-only review |
| `poteto-investigator` | Connected-source investigation |

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

OpenCode integration tests and the permission checker use test-owned servers,
private configuration and credentials, and disabled MCPs. They make no model
calls. The permission checker creates only isolated sessions and does not execute
tested actions. Use `PSTACK_CONTAINER_TEST=1 npm test` for container integration
checks. `PSTACK_REVIEW_PERMISSION_TEST=1` enables the installed review-permission
prerequisite test.

See [integration test isolation](docs/integration-test-isolation.md) for bounded
runs, ownership checks, and cleanup limits after crashes.

## Limits and documentation

- Full upstream parity is unfinished. Hosted Bugbot, cloud workers, and desktop
  or mobile drivers are not included.
- Container execution is offline and starts from a committed ref. Uncommitted
  parent changes are excluded. Model requests use the host's existing sign-in.
- Runtime API transport currently targets the shared local OpenCode service.
- Agents do not commit or push. External writes and destructive actions require
  specific approval.

See the [portability and parity guide](docs/pstack-port.md),
[container setup](container/README.md), and [work plan](docs/parity-plan.md).
The upstream MIT license and import provenance are preserved in [vendor/pstack](vendor/pstack/).
