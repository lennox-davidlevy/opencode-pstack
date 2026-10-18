# pstack on OpenCode: parity status

Upstream: [cursor/plugins `pstack`](https://github.com/cursor/plugins/tree/101b274dd991f694e1f7024be2157e5f3adf07de/pstack)
v0.15.25 (see `vendor/pstack/provenance.json`). Skills are the upstream files, byte for
byte, plus one generated block at the top of each `SKILL.md` that maps Cursor names to
OpenCode (`prompts/pstack-compatibility.md`, rendered by `scripts/sync_contract.py`).
Re-import with `python3 scripts/import_pstack.py <upstream>/pstack --revision <sha>`;
`pstack-runtime` and `pstack-setup-pstack` are native and are never overwritten by a sync.

## What maps to what

| Upstream capability | OpenCode | Status |
| --- | --- | --- |
| 54 skills, playbooks, principles | `pstack-*` skills, upstream text + mapping block | Works. Pilots below |
| `poteto-mode` router, `poteto-agent`, `comment-sicko` | agents `poteto`, `poteto-agent`, `poteto-reviewer` (`poteto-investigator` for MCP sources) | Works |
| `Task` fan-out, swarm, arena, panels | native `subagent` (up to 4 active) | Works. Verifier lanes that run commands use `poteto-agent`; `poteto-reviewer` is read-only (can read diffs) |
| `AskQuestion` | `question` | Works |
| Per-role models (`pstack-models.mdc`) | `pstack-models.json`, six tasks, passed as `model` | Works. Primary needs `--model` on `opencode run` |
| Transcript mining (recall, reflect, pickup) | `pstack.history_list` / `history_read` | Works, current project only |
| `/loop`, heartbeats | `pstack.loop` (durable, bounded, needs approval) | Implemented and unit tested. No live end-to-end pilot |
| Shipping: commit, push, PR, babysit | permission-gated `git commit` / `git push` (`ask`), `gh`, bundled `watch-pr` / `orch` (Bun) | Commit and push verified. PR create / babysit need `gh` auth and are not piloted |
| CLI / TUI control | `pstack.terminal` (PTY bridge) | Implemented and tested |
| Web UI control | Playwright MCP | Configured. Needs Chrome |
| Cloud agents (`environment: "cloud"`) | none. `pstack.worker` runs a committed ref in an offline container (experimental, Linux, max 2) | Gap. Not a cloud replacement |
| Bugbot, automations, desktop / mobile drivers | not available | Gap. Skills skip these steps and say so |

## Verified

Unit and integration suite (`npm test`, 281 tests), `PSTACK_PORTABILITY_TEST=1` (10),
`scripts/check_permissions.py` (76 decisions) pass, each run through
`scripts/gated-run.sh`. Live pilots with the real `opencode` 2.0.32 in a scratch repo:

- Bug fix: poteto loaded the playbook, reproduced, fixed, and delegated an independent
  `poteto-reviewer` pinned to the policy review model.
- Swarm: three parallel native verifier lanes, aggregation, and a `history_list` /
  `history_read` recall of the previous session.
- Shipping: commit and push to a remote, hash verified on the remote.

## Known gaps and next work

- Pilot the remaining playbooks: autopilot, babysit against a real PR, hillclimb,
  `pstack.loop` wakeups, PTY-driven app verification.
- Container workers: only for committed refs, Linux, two at a time, not for unattended use.
  See `docs/worker-recovery.md` and `container/README.md`.
- `docs/model-policy.md` describes the model task policy.

## Resource safety

Test and build runs go through `scripts/gated-run.sh`: transient systemd scope with memory
and task caps, no swap, wall-clock timeout, capped output, and a before/after check of
tmpfs fixtures, containers, and leftover processes. Details: `docs/integration-test-isolation.md`.
