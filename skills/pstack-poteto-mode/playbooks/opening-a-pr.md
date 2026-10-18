### Opening a PR

Invoked at the end of change-producing playbooks. Under the local grant, prepare review material and a verified local handoff, not an actual PR. Read-only work stays read-only.

**Worktree.** Record the baseline and preserve all pending dirty work. Independent items need stable isolated artifacts containing baseline plus only that item. Disjoint file ownership in one checkout does not isolate build inputs. If safe parallel isolation is unavailable, serialize preparation and verification with stable retained artifacts. Do not implicitly stash, reset, delete, or commit to obtain isolation. Block if no safe preparation is possible. Dependent combined artifacts use Autopilot-stack only.

**Local boundary.** Never commit or push, including through forge, stack, or PR wrappers. Under the local grant, do not create, edit, retarget, mark ready, comment on, or merge remote PRs. External writes need separate specific authorization, which never lifts the suite's no-commit/no-push rule. Keep publication steps as an unexecuted operator plan. Retain narrow ordered artifacts instead of creating commits for durability or identity.

**Review preparation.** Run pstack-unslop over the diff. After the candidate artifact exists, the primary commissions the pstack-no-comments read-only critique. Owners never invoke its spawning step or delegate. The primary returns accepted fixes to the scoped owner, then refreshes affected evidence. Follow Shipping for a permitted nonauthor poteto-agent runner and a separate poteto-reviewer that reads the actual artifact and receipts. Do not assign general shell, Playwright, or PTY execution to the read-only reviewer. Tool availability is not permission. Enforce a hard aggregate maximum of two active children across all owners, runners, comment reviewers, and artifact reviewers, with no configuration or pilot exceptions. Count retained resources and uncertain acquisitions until reconciled. Write proposed titles and descriptions with pstack-technical-writing, then pstack-unslop.

**Titles.** Conventional Commits `type(scope): subject`, no trailing period. Type such as `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or `perf`. Scope is the area, such as `pstack` or `poteto-mode`. Subject is short, imperative, and names a real symbol when one carries the change, for example `fix(pstack): retarget opening-a-pr babysit trigger`.

**Descriptions.** The PR body is a one-minute briefing, not a lab notebook, for a reviewer who has the diff. It says why the change exists, what it leaves out, what it could break, and how you proved it works. Write short, simple sentences with few identifiers, no walls of text. The body becomes the squash commit body, so keep that commit under about 40 lines. Use `##` headings, not bold lead-ins, in this order, and drop a section with nothing to say:

- `## Why`: the problem and approach, 1–3 short sentences. No SHAs, rebase genealogy, or "based on main" preamble.
- `## What changed`: 1–3 short bullets. Name a real symbol or path only when it carries the change. Name both sides of a rename or retarget.
- `## Scope`: always. 1–3 short items on what it covers and what it deliberately leaves out (a follow-up, a known gap). No symbols, paths, or file-by-file essay.
- `## Tradeoffs`: only rejected alternatives a reviewer would otherwise ask about. Skip when there was no real choice.
- `## Blast Radius`: 1–2 sentences on who or what it touches and why that is safe or risky. If main is red, state the cost of leaving it red.
- `## Verification`: 1–3 bullets, each a real run path and its outcome. Perf: one primary number with its unit, `before → after`, and a link to the arena or swarm directory for the rest. No sample-size methodology, swarm recitals, or metric tables.

After the sections, attach videos or screenshots when they prove a claim. Full SHAs, swarm or arena lane recitals, lever-correction essays, file-by-file checklists, and "CLEAN" verdicts go in a linked artifact, not the body.

**Forge.** Existing PR status is optional evidence, not a local handoff prerequisite. Use only authorized read operations through a verified installed forge CLI. The bundled watcher is GitHub-specific and follows Babysit's prerequisites. Record missing forge access as a coverage gap. Do not require Graphite (`gt`) or invent PR URLs.

**Built-in PR tool.** A tool's presence does not authorize remote writes. Record any available tool for the operator's publication plan, but do not call its mutation operations under the local grant.

**Size and stacks.** Prefer narrow review units to one large artifact. Plan independent items against trunk under Autopilot-full. Plan dependent items in an explicit parent chain under Autopilot-stack. Record intended PR bases as a proposal, not an existing forge stack. Shipping rechecks evidence after parent changes. It does not authorize rebasing or retargeting.

**Readiness.** Propose ready-for-review publication only after local acceptance. Do not mark a remote PR ready under the local grant. Describe an existing PR's status only from a supplied or authorized observed record, with its exact head and coverage limits. Missing cloud drivers or hosted Bugbot remain `BLOCKED`, not local equivalents.

**Babysit.** Preparing a handoff does not start babysitting. Return to the primary and keep the approved queue moving. A separate user request may start Babysit's bounded local triage. Do not start one watcher per item.

A subagent returns changed files, exact artifact identity, checks and receipts, and open gates. Autopilot owners have no exception for publishing, nested comment review, or babysit loops. Only the primary dispatches follow-up work within the aggregate cap. Replacement waits for actual execution, resource, and writer quiescence, never silence. The handoff states that nothing was committed, pushed, or externally published.
