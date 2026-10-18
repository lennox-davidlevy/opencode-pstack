---
name: why
description: "Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers available MCPs and queries each evidence category (source control, issue tracker, long-form docs, real-time chat, infrastructure observability, error tracking, product analytics warehouse) in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior."
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


# Why

Investigate the motivation and intent behind code. The companion `how` skill answers what the code does and how it works. `why` answers what forces led to its shape.

Read project-local `pstack-models.json`. Investigators use the `investigation` task and the synthesizer uses `coordination`. Pass the task's exact policy value as `model` to native `subagent` calls. Follow `pstack-runtime` for missing or rejected models. Do not adjust variants or substitute a fallback.

Use `poteto-investigator` for connected-source investigation and citation spot-checks. Use `poteto-reviewer` for synthesis that only reads local evidence. Keep their configured permissions. Read-only work never becomes write-authorized because of its model profile.

## Operating Posture

Operate as a **careful, cautious, and precise investigator**. Be honest about what you know vs what you're inferring. Read `references/epistemics.md` for the full confidence framework and phrasing guide. The synthesizer must follow it.

## Step 1. Understand the Target and the Question

The **target** is usually a chunk of code, a pattern, a feature, or a named design decision. The **question** is usually a design rationale, a tradeoff, a motivating edge case, an external constraint, dead code, or a broad history sweep.

If the target is vague ("why do we do it this way?" with no clear referent), make your best guess from conversation context (open files, recent edits, cursor location, what was just discussed). State your interpretation briefly so the user can redirect if you're off, then proceed.

## Step 2. Establish the Code Anchor

Before spawning investigators, build the seed context inline: file paths and line ranges, key symbols (functions, classes, constants), the last few commits touching the target, PR numbers from merge commits (pattern `(#1234)` in the subject line), and any linked ticket IDs. Run `git blame -L <start>,<end> <file>` for last-touch commits, `git log --follow -p -- <file>` for full history with patches through renames, `git log --oneline -20 -- <file>` for recent commits with PR numbers visible, and `git log -1 --format=%B <commit>` to extract PR numbers. Then pull the PR bodies and discussion for any substantive commit: `gh pr view <number> --json title,body,author,createdAt,mergedAt,labels,closingIssuesReferences,comments,reviews`. This anchor goes to every investigator and to the synthesizer.

## Step 3. Spawn Parallel Investigators

**Default to the full parallel investigation.** The goal is a complete coverage map, not a minimal one. Document the null, don't skip the search.

### Discovery

Before spawning investigators, list the available MCPs from the Cursor environment. Use the available-tools map when present. Otherwise inspect the `mcps/` directory Cursor exposes for enabled MCP servers.

Map each available MCP to one evidence category:

1. Source control history
2. Issue / ticket tracker
3. Long-form documents
4. Real-time team chat
5. Infrastructure observability
6. Error / exception tracking
7. Product analytics warehouse

Source control is always available through git and `gh`. For the other six, classify using the MCP name, server instructions, tool names, and resource descriptors. If an MCP could fit more than one category, choose the one matching its primary evidence. Record ambiguous cases in the coverage map.

Spawn one investigator per category that has a matching MCP, all in a single message so they run concurrently, each owning exactly one tool or MCP. Don't ask one agent to cover multiple MCPs. Use the `investigation` task's exact policy model.

Each investigator's prompt is `references/investigator-prompt.md` filled in, plus:
- the category playbook `references/sources/<source>.md` for the selected MCP, adapted from the examples in `references/source-playbook.md`
- `references/sources/incident-postmortem.md` **if the target code looks defensive** (null checks, retry logic, timeout handling, rate limiting, feature flags, egress guards, OOM handlers)
- the code anchor and the user's original question

### Investigator roster, one per available evidence category

Each category below is uniquely positioned to surface one shape of "why", shown after "Best at". Use it to know what to expect back, to name a gap when a category returns empty, and, only in the rare provably-irrelevant case, to justify a skip.

1. **Source control** (git history, `gh` for PRs, code comments, tests). Always spawn, the only guaranteed source. Best at *implementation-time rationale captured during review*.
2. **Issue / ticket tracker** (e.g. Linear, Jira, GitHub Issues, Plane, Shortcut MCP). Best at *the product or business forcing function*. Strongest when the why is external to engineering.
3. **Long-form documents** (e.g. Notion, Confluence, Google Docs, Coda MCP). Best at *long-form design rationale*, written out before it becomes code.
4. **Real-time team chat** (e.g. Slack, Discord, Microsoft Teams, Mattermost MCP). Best at *real-time deliberation that never reached a doc*. Especially important when the source control, ticket, and doc paper trail is thin.
5. **Infrastructure observability** (e.g. Datadog, New Relic, Honeycomb, Grafana, Splunk MCP). Best at *infrastructure and runtime reality that motivated the code*. Strongest when the target reacts to an infra signal (timeouts, retries, rate limits, circuit breakers).
6. **Error / exception tracking** (e.g. Sentry, Rollbar, Bugsnag, Airbrake MCP). Best at *the specific exceptions and error trajectories that motivated defensive or corrective code*. Strongest for catch blocks, null guards, type checks, retries, and other defenses.
7. **Product analytics warehouse** (e.g. Databricks, Snowflake, BigQuery, ClickHouse, dbt, Redshift MCP). Best at *product and data reality that shaped the code*. Strongest for flag-gated code, experiment-driven ships, data migrations, and "where did this number come from" questions.

### When to skip an investigator

Only with an **explicit, written justification** that goes in the final Sources Consulted. Two valid reasons:

- **No MCP is available for that category** in this environment. Flag it as a gap, not a choice: "Real-time team chat skipped. No matching MCP available, so the conversational record was not searchable."
- **The source is provably irrelevant**, not just "probably irrelevant." A high bar: "Error / exception tracking skipped. Target is a build-time script with no runtime code path."

If your scope assessment suggests a single-commit trivial target where the PR description already contains the complete answer, you may answer inline **only after** confirming all seven available category searches would be redundant. Say so explicitly. This should be rare.

## Step 4. Synthesize

Spawn one synthesizer using the `coordination` task's exact policy model. It gets:
1. The investigator findings, including any null results and any categories skipped with justification
2. The code anchor
3. The user's original question
4. The epistemics framework from `references/epistemics.md`
5. The synthesizer prompt template from `references/synthesizer-prompt.md`

## Step 5. Present

Present the synthesizer's output to the user. You may lightly edit for clarity or add context from the conversation, but **do not rewrite the confidence language**.

## Output Format

The structure is the one in `references/synthesizer-prompt.md`: The Question, The Code in Question, What We Found, What We Can Reasonably Infer, Competing Hypotheses, What We Don't Know, Sources Consulted, Confidence Summary. Adapt as needed, but keep the confidence separation intact, and keep Sources Consulted as one line per investigator, including the ones that returned nothing or were skipped, with the reason.

After Sources Consulted, if the user's `why` question is a precursor to changing this code, convert the lineage findings into a Preserve / Change / Avoid / Risk constraint set for planning the change.

## Common Failure Modes to Avoid

- **Recency bias**. Assuming the most recent commit is authoritative. The current shape is often the accretion of many earlier decisions. Trace back.
