---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
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
  Keep at most two active children across owners, runners, and reviewers.
  Retained live resources and uncertain acquisitions still consume capacity.
  Plan larger panels in bounded waves, never by raising this aggregate ceiling.
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
- Read project-local `pstack-models.json` before selecting delegate models. Its
  six tasks are coordination, implementation, hard, investigation, review, and
  mechanical. The user-approved policy authorizes those exact discovered
  `provider/model#variant` values. Never invent a fallback or adjust a suffix.
- For native `subagent` calls, choose the task and pass its exact policy value as
  `model`. Keep the agent role and permissions appropriate to the work. Workers
  accept optional `task`, default from the role through policy `defaults`, and
  resolve the model themselves. Neither path forces the parent's model. See
  `pstack-runtime` for selection details. Missing or rejected models are gaps.
- Panels start with the implementation and review task models. Require distinct
  configured model IDs, not just variants or fresh contexts. Report diversity
  gaps without substituting an unapproved model. No `panels` key is needed.
- Use `pstack-setup-pstack` to change project policy and synchronize agent defaults.
  This does not switch an existing session's selected model. Only the human does.
- Never commit or push, including wrappers. External writes, destructive actions,
  production access, and scope expansion need specific confirmation. Shipping
  ends at a verified local handoff unless separately authorized within these
  limits. Full-autonomy language never overrides permission gates.
- Load pstack-principle-test-behavior-not-implementation before changing tests.
  Keep tests at observable boundaries, justify each by a credible regression,
  and never add test-only production seams. Reviews do not authorize editing.
- Before every test, build, benchmark, or integration run, establish the resource
  baseline. After success, failure, or timeout, require PASS from "Check resources
  after every run" in bundle-root `docs/integration-test-isolation.md`
  (`../../docs/integration-test-isolation.md` from a bundled skill directory).
  Block retries, further runs, and completion claims on FAIL or INCONCLUSIVE.
  Only permitted primary or implementation runners execute checks and authorized
  cleanup. Read-only roles verify receipts or request a permitted runner.
- Bundled scripts are real programs with side effects, not permission bypasses.
  Inspect them before use. The local worktree audit is an inventory, not proof
  of inactivity or permission to delete. Unknown activity requires review.

The upstream text below retains workflow detail. Where it assumes Cursor or
grants broader autonomy, the OpenCode contract above replaces that assumption.


# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Explorers use the `investigation` task profile. Explainers use `coordination`. Read both exact model strings from project-local `pstack-models.json` and pass them as `model` to native `subagent` calls. Use `poteto-reviewer` for local read-only exploration or explanation, and `poteto-investigator` when connected-source queries are needed. Task selection never broadens permissions. Follow `pstack-runtime` for missing or rejected models. Do not adjust variants or substitute a fallback.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Spawn one explainer that explores and explains in one pass, built from `references/explainer-prompt.md` without the explorer-findings section. Go to step 4.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): go to step 2.

When in doubt, take the simple path.

## 2. Explore (complex only)

Decompose the question into 2 to 4 angles, each a distinct slice of the subsystem. Spawn all explorers in a single message, each with `references/explorer-prompt.md` and its angle filled in.

## 3. Synthesize (complex only)

Once all explorers have returned, spawn one explainer with `references/explainer-prompt.md` and every explorer's findings filled in.

## 4. Present

Present the explainer's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
