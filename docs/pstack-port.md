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
| `/loop`, heartbeats | `pstack.loop` (durable, bounded, needs approval) | Works live: scheduled wakeups delivered and the job completed. One babysit run saw `Wakeup permission is not allow` at delivery and did not reproduce; if it recurs, check that run's `pstack_wakeup` decision |
| Shipping: commit, push, PR, babysit | permission-gated `git commit` / `git push` (`ask`), `gh`, bundled `watch-pr` / `orch` (Bun) | PR flow verified against a real repo: branch, commit, push, ready PR, CI green, independent review. `watch-pr` needs `bun install` in the bundle on first use (not exercised; the pilot used `gh`) |
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
- Full PR loop on a private GitHub scratch repo: red CI on master, poteto fixed it on a branch,
  opened a ready PR with `gh`, babysat CI to green, and had `poteto-reviewer` review the diff.
- `pstack.loop`: two scheduled wakeups delivered in a live session.
- Autopilot-full: two independent items, one `poteto-agent` owner each in its own git worktree
  (cap of 2 children respected), independent `poteto-reviewer`, two ready PRs. CI on both was red
  only from the unrelated failing test on master, which the run left alone as out of scope.
  Cursor-only steps (cloud agents, Bugbot, merge) were skipped and reported.

## Known gaps and next work

- Pilot the remaining playbooks: hillclimb, autopilot with a merge, `watch-pr` after `bun install`,
  PTY-driven app verification.
- Container workers: only for committed refs, Linux, two at a time, not for unattended use.
  See `docs/worker-recovery.md` and `container/README.md`.
- `docs/model-policy.md` describes the model task policy.

## Resource safety

Test and build runs go through `scripts/gated-run.sh`: transient systemd scope with memory
and task caps, no swap, wall-clock timeout, capped output, and a before/after check of
tmpfs fixtures, containers, and leftover processes. Details: `docs/integration-test-isolation.md`.
