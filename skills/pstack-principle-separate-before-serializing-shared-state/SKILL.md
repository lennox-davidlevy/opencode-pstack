---
name: principle-separate-before-serializing-shared-state
description: "Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant."
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


# Separate Before Serializing Shared State

When concurrent actors might share mutable state, first ask whether they need the same mutable object. If not, eliminate the sharing. When sharing is real, enforce serialization structurally: lockfiles, sequential phases, exclusive ownership. Instructions and conventions are not concurrency control.

**Why:** Concurrent writes to shared state create race conditions that are intermittent, hard to reproduce, and expensive to debug.

**Pattern:**
1. **Identify shared mutable state** (files both read and write, branches both push to, APIs both define and consume).
2. **Default: eliminate the shared write target.** Ask: do these actors need one canonical object, or are they publishing independent facts? Give each actor its own owned file, key, branch, or state directory, and merge only at the read/reporting boundary. Two workers writing their own `lastX` field into one `state.json` is still shared mutation. `indexer-state.json` + `metrics-state.json` is not.
3. **Only when one shared write target is a real invariant, serialize access structurally** (lockfiles, sequential phases, single-writer actor, or atomic compare-and-swap). Treat "we need a lock" as a design smell to check, not as the default answer.
