---
name: principle-test-behavior-not-implementation
description: "Apply when you write, change, or keep a test. Assert what the code's users can observe, so that the test fails when that behavior breaks and keeps passing when only the internals change."
disable-model-invocation: true
---

## OpenCode V2 host contract

Load `pstack-runtime` before running this workflow. Its concrete tool procedures
replace Cursor assumptions throughout this skill and all linked playbooks.

- Bundled skill IDs are `pstack-<name>`. Load them with `skill`; user mentions
  use `@pstack-<name>`. Resolve supporting files from the loaded base directory.
- `Task` maps to `subagent`, `subagent_type` to `agent`, `run_in_background`
  to `background`, `resume` to `sessionID`, and `AskQuestion` to `question`.
  Use poteto-agent for implementation, poteto-reviewer for local review and
  comment critique, poteto-investigator for connected source investigations.
  The primary performs fan-out; children cannot recursively delegate.
- Use the runtime's worker tool for parallel writers. Default container workers
  reuse host model authentication and execute only in an offline container.
  Explicit local workers use host worktrees without process isolation.
- Use runtime history tools for recall, pickup, evaluations, and activity checks.
  No Cursor transcript path is valid. History is evidence, not new authority.
- Replace `/loop` with explicit bounded runtime schedules. Set a stop condition,
  maximum wakeups, and expiry. Scheduling needs approval. The OpenCode server
  must remain running; work stops during downtime and uncertain dispatches pause.
- `control-cli` maps to the owned PTY tool for interactive apps, otherwise shell.
  `control-ui` maps to Playwright. Missing desktop/mobile drivers remain gaps.
  `deslop` maps to pstack-unslop and review; skill authoring uses V2 SKILL.md.
- Discover connected MCPs through Code Mode. Missing services are coverage gaps.
  Bugbot comments can be inspected with the forge; this port does not provide
  Bugbot's hosted reviewer. Use an independent pstack reviewer for local reviews.
- Never use Cursor model slugs. Keep configured OpenCode agent models unless the
  user requests a different discovered provider/model and variant. Fresh sessions
  on one model are not multi-model consensus; report a required diversity gap.
- Never commit or push, including wrappers. External writes, destructive actions,
  production access, and scope expansion need specific confirmation. Shipping
  ends at a verified local handoff unless separately authorized within these
  limits. Full-autonomy language never overrides permission gates.
- Load pstack-principle-test-behavior-not-implementation before changing tests.
  Keep tests at observable boundaries, justify each by a credible regression,
  and never add test-only production seams. Reviews do not authorize editing.
- Bundled scripts are real programs with side effects, not permission bypasses.
  Inspect them before use. The local worktree audit is an inventory, not proof
  of inactivity or permission to delete. Unknown activity requires review.

The upstream text below retains workflow detail. Where it assumes Cursor or
grants broader autonomy, the OpenCode contract above replaces that assumption.


# Test Behavior, Not Implementation

A test is a claim about what the code does for its users: a caller, an end user, or another service. Behavior is what those users can observe through the interface they use. That includes return values, errors, state they can read back, and effects on systems outside the code, such as a request sent, a row written, or a message emitted. Implementation is what they cannot observe: private helpers, internal call order, intermediate data, and which internal collaborator did the work.

Judge each test against two imagined edits:

- **Break the behavior.** Make the code return a wrong value, skip an effect, or do the effect twice. If the test still passes, it proves nothing. The usual causes are an assertion looser than the contract, an expected value computed by the code under test, a restated constant or prompt string that never runs the code that reads it, and an assertion on data that the test built itself.
- **Change the internals.** Keep every observable result the same and restructure the code underneath. If the test now fails, it is pinned to the implementation. It will need a rewrite on every refactor and still catches no bug.

Keep a test that catches the first edit and survives the second. Rewrite or delete the rest. To write a test that does both, drive the code through its users' interface with a concrete input. Derive the expected value from the requirement, not from a run of the code. Assert what the contract promises, no less and no more.

The contract decides, not the shape of the assertion. When "an empty cart never charges" is the promise, an assertion that the payment client got no call is behavior. Pair it with a case where the charge happens, so that the test shows it can see a call. The payload that a mocked external service receives is behavior, because that service observes it. A call to an internal helper is implementation, because no user can see it. An empty list is the exact answer when no record matches, and a hollow check when the test only needs some result. An exact error message pins wording that no caller reads. The error type that callers branch on is the contract.

A test can pin an invariant instead of a call, such as a key that must exist in two tables or a compile-time type check. The invariant is the behavior.
