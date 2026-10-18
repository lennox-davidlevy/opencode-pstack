---
name: principle-test-behavior-not-implementation
description: "Apply when you write, change, or keep a test. Assert what the code's users can observe, so that the test fails when that behavior breaks and keeps passing when only the internals change."
disable-model-invocation: true
---

<!-- opencode-host:start -->
> **OpenCode host.** This skill was written for Cursor. Load `pstack-runtime` once per
> session and apply this map wherever the text below uses a Cursor name. If a name has
> no row, skip that step and say so. Never pass a field the tool schema rejects.
>
> | Cursor | OpenCode |
> | --- | --- |
> | `/name`, "the **name** skill", `@name` | `skill` tool with `pstack-<name>`; users type `@pstack-<name>` |
> | `Task`, `subagent_type`, `resume`, `run_in_background` | `subagent`, `agent`, `sessionID`, `background` |
> | `generalPurpose` writer / `poteto-agent` | `poteto-agent` (implementation, may edit) |
> | `readonly` explorer, `comment-sicko` | `poteto-reviewer` (read, grep, git inspection; cannot run tests) |
> | A verifier lane that must run tests or drive the app | `poteto-agent`, briefed "do not edit source"; check `git status` afterward |
> | Connected-source (MCP) lanes | `poteto-investigator` |
> | `AskQuestion` | `question` |
> | `environment: "cloud"` workers, cloud agents | no cloud. Use parallel native `subagent` calls (up to 4 active, disjoint files or serialize). For isolation from the working tree use `pstack.worker` on a committed ref. Otherwise report the gap |
> | `/loop`, automations | `pstack.loop` (bounded: stop condition, `maxRuns`, expiry; needs approval) |
> | Agent transcripts, `~/.cursor/projects/...` | `pstack.history_list` / `pstack.history_read` (current project only) |
> | `pstack-models.mdc` rule | `pstack-models.json` at the bundle root; pass the task's exact `model` to `subagent` |
> | `control-cli` / `control-ui` | `pstack.terminal` or shell / Playwright MCP. Desktop and mobile drivers are gaps |
> | `deslop` (cursor-team-kit) | `pstack-unslop` plus `pstack-no-comments` |
> | `origin pr`, Origin | `gh` (GitHub CLI); `gt` is never required |
> | Bugbot, Cursor's PR tool, Cursor-hosted services | not available; skip and say so |
>
> Commits, pushes and PR writes are permission-gated (`ask`). Do them when the playbook
> reaches them and the user's request covers shipping; otherwise stop at a verified local
> handoff. Never force-push without a specific ask. Full-autonomy wording never overrides
> a permission prompt. Before substantive test changes load
> `pstack-principle-test-behavior-not-implementation`. Run quick focused checks directly. Wrap
> long or memory-heavy suites in `scripts/gated-run.sh` from the bundle root (memory, task and
> time caps plus a leftover-file check).
<!-- opencode-host:end -->

# Test Behavior, Not Implementation

A test is a claim about what the code does for its users: a caller, an end user, or another service. Behavior is what those users can observe through the interface they use. That includes return values, errors, state they can read back, and effects on systems outside the code, such as a request sent, a row written, or a message emitted. Implementation is what they cannot observe: private helpers, internal call order, intermediate data, and which internal collaborator did the work.

Judge each test against two imagined edits:

- **Break the behavior.** Make the code return a wrong value, skip an effect, or do the effect twice. If the test still passes, it proves nothing. The usual causes are an assertion looser than the contract, an expected value computed by the code under test, a restated constant or prompt string that never runs the code that reads it, and an assertion on data that the test built itself.
- **Change the internals.** Keep every observable result the same and restructure the code underneath. If the test now fails, it is pinned to the implementation. It will need a rewrite on every refactor and still catches no bug.

Keep a test that catches the first edit and survives the second. Rewrite or delete the rest. To write a test that does both, drive the code through its users' interface with a concrete input. Derive the expected value from the requirement, not from a run of the code. Assert what the contract promises, no less and no more.

The contract decides, not the shape of the assertion. When "an empty cart never charges" is the promise, an assertion that the payment client got no call is behavior. Pair it with a case where the charge happens, so that the test shows it can see a call. The payload that a mocked external service receives is behavior, because that service observes it. A call to an internal helper is implementation, because no user can see it. An empty list is the exact answer when no record matches, and a hollow check when the test only needs some result. An exact error message pins wording that no caller reads. The error type that callers branch on is the contract.

A test can pin an invariant instead of a call, such as a key that must exist in two tables or a compile-time type check. The invariant is the behavior.
