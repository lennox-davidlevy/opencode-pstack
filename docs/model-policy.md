# Project task model policy

This project uses explicit task models so delegation does not depend on the
parent session's selection. The user approved this mapping after discovery of
the exact model IDs and variants. It is project-local, not an upstream or global
default. Availability does not establish comparative quality, speed, or cost.

## Approved mapping

`pstack-models.json` is the source of truth. Its shape is `version: 1`, `tasks`
mapping six task names to model strings, and `defaults` mapping agents to tasks.

| Task | Exact model | Purpose |
| --- | --- | --- |
| `coordination` | `openai/gpt-6.1-sol#high` | Planning and synthesis |
| `implementation` | `openai/gpt-6.1-sol#high` | Normal implementation and verification |
| `hard` | `openai/gpt-6.1-sol#xhigh` | Explicit escalation for difficult work |
| `investigation` | `openai/gpt-6.1-sol#medium` | Source exploration and evidence gathering |
| `review` | `openai/gpt-6-astra#high` | Independent critique |
| `mechanical` | `openai/gpt-5.3-codex-spark#high` | Bounded trial for specified edits |

The `mechanical` profile needs a narrow scope and observable checks. Its use
carries no quality or cost promise. Rejected or unavailable models are reported
as gaps. There are no invented fallbacks, aliases, or automatic effort changes.

Agent defaults map `poteto` to `coordination`, `poteto-agent` to `implementation`,
`poteto-reviewer` to `review`, and `poteto-investigator` to `investigation`.
`scripts/sync_models.mjs` synchronizes these defaults into Markdown model fields.
Its `--check` mode detects drift without writes. Setup changes the project
policy, not agent permissions or duplicate JSON definitions.

## Native delegates and workers

For native `subagent` calls, the coordinator chooses a task and passes its exact
policy model as `model`. The native tool does not take a task-policy parameter.
For `pstack.worker`, optional `task` selects the profile. Omission resolves the
role's policy default. Workers do not force the parent session's model.

Model choice does not change authority. An implementation-model seat can still
use the read-only reviewer role. Connected-source work keeps the investigator's
permissions. The approved policy authorizes its exact models for these tasks
without another model-choice confirmation for each dispatch.

Panels start with the implementation and review profiles. They need distinct
provider/model IDs, not only different variants or fresh sessions. Both approved
models use OpenAI, so this is model diversity, not provider diversity. A separate
`panels` key is unnecessary. A missing distinct model is a reported coverage gap.

## Existing sessions

The current session keeps its selected model until the human changes it.
Changing project policy or agent frontmatter does not switch that session.
Setup does not change global configuration, restart servers, or execute models.

## Verification status

Static checks cover generated host-contract freshness, legacy routing references,
policy consistency, and synchronized Markdown defaults. Runtime routing and model
execution are separate claims. No quality, latency, or cost comparison is implied.

Static results for this setup:

- `python3 scripts/sync_contract.py --check` reports `0 contracts stale` after
  regeneration of 52 entrypoints.
- `node scripts/sync_models.mjs --check` reports that agent models match policy.
- The approved six-task table matches `pstack-models.json`. The default panel
  has two distinct provider/model IDs.
- Changed skill entrypoints have `name` and `description` frontmatter. Local
  Markdown links resolve. A scan of skill Markdown finds no legacy Cursor model
  defaults, model-rule references, or model-suffix adjustment instructions.
- `git diff --check` passes.

Runtime checks completed on 2026-10-17:

- Registered worker-dispatch tests covered local and container backends with a
  deliberately different parent model. Requests and stored receipts used the
  selected task model. Role permissions and parent restrictions remained intact.
  SDK services, Git, Docker, and CLI transports were fixtures in these tests.
- A test-owned OpenCode 2.0.32 server reported the configured defaults in all
  three installation layouts. It created and read back sessions for every task
  and role default, preserving exact model references and the parent's model.
  These tests made no model-generation requests.
- The targeted suite passed 19 tests. The final full suite passed 129 tests, with 11
  Bun-dependent bootstrap tests skipped because Bun was absent on the test PATH.
  Runs used a 2 GiB cgroup memory ceiling and bounded deadlines.
- TypeScript, model synchronization, shared-contract freshness, and whitespace
  checks passed. The ten Python tests passed.
- Independent review found that synchronization could modify a hardlinked alias.
  A temporary-fixture regression reproduced the missing rejection. Synchronization
  now rejects multiply linked agent files before writes, and the regression passes.
- The shared OpenCode server retained its PID and start time. No additional
  OpenCode processes remained, and the Docker container inventory was unchanged.

Native task classification remains instruction-driven. The coordinator reads
the policy and passes an explicit model to the native delegation tool. Session
readback does not prove that every future native dispatch will follow those
instructions. These checks do not benchmark model quality, speed, or cost, and
do not prove authenticated generation on every configured model. Logs are under
`/tmp/opencode/pstack-model-routing/` for this local run. No shared-server
session was created for testing or restarted.

Use `@pstack-setup-pstack` for future changes. Inspect scripts before running them,
then run `node scripts/sync_models.mjs` and `node scripts/sync_models.mjs --check`
from the bundle root. Static verification results are recorded with the handoff.
