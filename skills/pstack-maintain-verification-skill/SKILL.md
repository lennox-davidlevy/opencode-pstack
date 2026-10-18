---
name: maintain-verification-skill
description: "Periodic pass that keeps a project's verification skill and feature map honest: parallel source readers per feature, one live session driving every feature, at most one PR of proven corrections. Use for /maintain-verification-skill or \"audit the verify skill\"."
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


# Maintain a verification skill

A feature map rots the moment the app changes. This skill is the upkeep loop for a skill generated by `/create-verification-skill` (or any project-local verification skill with a feature map). The unit of rigor is the feature, not every sentence: cover every feature file from source and exercise every feature live, without terminalising every bullet.

## Outcomes

Pick one, and say which:

- **clean** — every feature got source and live coverage; nothing worth shipping. No branch, no PR.
- **changed** — one PR ships proven doc, harness, or map corrections.
- **blocked** — coverage could not finish or a proven fix could not ship safely. Say exactly what blocked it.

## Edit scope

Only edit the verification skill's own directory (its SKILL.md, features/, and any harness scripts it owns). Never edit product code during a run: a behavior the map describes that the app no longer does is either doc drift (fix the map) or a product regression (report it, don't paper over it in docs).

## Pass

0. **Locate the target.** Find the verification skill to maintain: the project-local skill whose body has launch/drive sections and a feature map (usually `.cursor/skills/verify-*/`). Several candidates → ask which one; none → stop and point at `/create-verification-skill` instead of inventing a target.

1. **Index hygiene.** Read the feature map README and glob its sibling files. Fix missing, extra, duplicate, or dead entries. Lightweight; no generated inventory.

2. **Source wave.** One read-only subagent per feature file, launched concurrently. Each explains "how does this user-facing feature work?" from source, flags likely doc drift with citations, and returns one concise live-verification recipe. Children never drive the app and never edit files. Return shape: feature summary / source entry points / likely drift or none / one recipe.

3. **Reconcile.** Every feature file has a returned summary. Merge overlapping recipes into as few app states as practical. Spot-check cited drift; don't re-prove clean claims. Sweep recent churn for user-facing surfaces missing from the map — require a concrete source path before calling one missing.

4. **Live pass.** Required even when source looks clean. The coordinator owns all driving; follow the verification skill's own launch model — one long-lived instance driven serially for servers and UIs, or a fresh isolated session per drive for short-lived CLIs (the skill's Launch section decides, not this one). Exercise every feature at least once, and hold three invariants the whole pass, whatever the failure: (1) never drive an instance you haven't health-checked since it last did something surprising — doctor before first drive, doctor on each fresh session where sessions are the unit, doctor again after any failed drive, and where doctor can't see the failure (a wedged UI state on a healthy process), reset to a known state or relaunch rather than hoping; (2) evidence captured so far survives every cleanup, checked at its named location, not assumed; (3) nothing a drive started outlives that drive's usefulness — failed-iteration residue is cleaned whether the session is stuck, exited, or shared (for a shared instance, clean the residue, not the instance). A doctor failure caused by skill drift is drift: fix it under edit scope and retry once — restart whatever the fix invalidated, nothing more — before calling the pass `blocked`. A feature that can't be reached is `verified-unreachable` only with the concrete prerequisite (auth, entitlement, OS, external state) and the route attempted; if the map omits that prerequisite, that's drift. Any harness fix from triage gets re-driven live before it ships. Final teardown happens after the last drive of the run — including those re-proofs — so nothing outlives the run (evidence stays, per the skill).

5. **Triage.** Wrong or missing user-POV description → doc drift, fix it. Working behavior the harness can't drive → harness gap, fix it; a harness fix follows the same helpers rule as generation (scripts executable, invocation documented in the skill body). App behavior that's actually broken → product gap; record it for the user, keep it out of this PR.

6. **Ship or stop.** For changed: one PR of proven corrections, re-read every changed file first. For clean or blocked: no PR, report the outcome and the coverage honestly.

Keep concise run notes (features covered, unreachable prerequisites, confirmed drift, outcome) in a scratch location; don't commit them.
