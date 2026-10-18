### Orchestrate

Run a standing local program through one primary coordinator. Use Autonomous run for one task with a stop predicate. Use figure-it-out for one bespoke run. This playbook prepares and verifies local work. It does not authorize publishing or landing.

#### Roles and placement

- The primary frames the program, writes briefs, dispatches every child, drains reports, and owns the handoff. It never commits or pushes, including through a wrapper. Merge, retarget, comment, tracker, and other external writes need separate specific authorization. Such authorization does not lift this suite's no-commit/no-push rule.
- Track owners are bounded children, not sub-coordinators. They return findings or changes for their assigned slice. They cannot spawn workers, verifiers, or schedules. The primary dispatches all follow-up and verification work.
- Native children may edit disjoint files in the current dirty checkout, but disjoint writes do not isolate build inputs. Follow the artifact rules below before verification. Use `pstack-runtime` worker procedures only when their prerequisites are met. Container workers require a committed ref and exclude uncommitted parent changes. Their execution is offline. Explicit local workers use host worktrees without process isolation. Neither backend is a cloud agent or a VM sandbox.
- Keep one writer per file set and one topology owner per local stack. Pass each child the mode SKILL.md path, its allowed paths, all standing orders, and the exact task model from project-local `pstack-models.json`. Preserve role permissions. Use a nonauthor `poteto-agent` for permitted execution and `poteto-reviewer` for read-only artifact and receipt review.

#### Capacity and planned waves

Enforce a hard aggregate maximum of two active children across all owners, runners, comment reviewers, and artifact reviewers. Count all primary-owned work, not two per track or tool. Configuration and a successful pilot cannot raise this cap. Reduce it for memory, tooling, or shared-resource constraints.

Plan waves by dependency, exclusive paths, and required resources before dispatch. Admission must include retained resources and uncertain acquisitions, not just active model turns. Do not count a timeout or missing reply as released capacity. If admission refuses or capacity is uncertain, stop refill and reconcile evidence.

These are coordinator rules, not a claim that runtime admission is integrated. An admission module or unit-test result alone does not establish enforcement at worker start and cleanup. Until that integration is demonstrated, enforce the two-child bound manually and report the runtime gap. No child delegation is permitted at any capacity.

#### Local store and inspected commands

Choose an explicit project-local `orchestrate/<project-slug>/` directory within the authorized write scope. Do not assume a system-provided agent store. The primary is the only writer to the program tables. Children return reports for the primary to record.

From this skill directory, use `bun --no-install scripts/orch/orch.ts --store <store-dir> <command>`, abbreviated below as `orch`. Resolve `<store-dir>` explicitly. Inspect bundled scripts before running them. The CLI does bookkeeping only. It does not dispatch children, enforce admission, schedule wakeups, or recover ownership.

The CLI needs Bun and current local dependencies. A normal invocation fails without installing missing or stale dependencies. Installation needs separate approval before `bun --no-install scripts/bootstrap.ts --install`. Setup does not replay the original command.

Use these inspected command forms:

```text
orch init
orch standing add <line>
orch unit add <id> --track <track> --brief <path>
orch unit set <id> --state <state> [--branch <branch>] [--pr <number>] [--sha <sha>]
orch inbox push <agent> <unit> <status> [--report <path>]
orch inbox drain --peek
orch inbox drain
orch ledger record <pr> <sha> <verdict> --evidence <path> --verifier <name>
orch ledger check <pr> <sha>
orch frontier set --repo <repo-dir> [--forge gh|origin]
orch frontier show
orch status
```

`init`, standing-order updates, unit updates, inbox push/drain, ledger record, frontier set, and status write local state. Mutations acquire a local lock. Queries do not provide locked snapshots. `inbox drain` consumes pointers. Preserve its output in the local decision trail before acting on it. `status` regenerates `status.md`. Do not call these mutations read-only.

The CLI manages `preferences.md`, `units.tsv`, `inbox/`, `gates.md`, `ledger.tsv`, `frontier.json`, and derived `status.md`. Keep briefs, reports, decisions, and local artifact evidence beside them with explicit ownership. Paste standing orders verbatim into every dispatch and any justified resume.

The ledger requires a real positive PR number and a SHA. It cannot key an uncommitted local artifact. For local-only units, leave PR fields empty and retain a report keyed by unit, base ref, changed paths, and content digests. Do not invent PR numbers or a ledger API. `frontier set` reads authenticated forge state and local branch refs, then writes the local frontier. Use it only for existing PR chains when such reads are authorized. It fails for branches without PRs. Record local dependency order separately rather than treating an empty forge frontier as a verified local stack.

#### Write each brief

Give each child the following fields. Missing scope, acceptance, or verification details block dispatch.

```text
GOAL         one checkable outcome
SCOPE        allowed paths and exclusive checkout or file set, plus forbidden paths
CONTEXT      mode SKILL.md path, input refs, reports, and evidence coverage limits
ACCEPTANCE   observable criteria
VERIFY       exact bounded checks and required driver or service
TIMEBOX      stop time and partial-result report on expiry
FORBIDDEN    no delegation, commits, pushes, external writes, or out-of-scope fixes
REPORT       changed files, artifact identity, commands and results, gaps, next action
STANDING     all current standing orders, verbatim
```

Collapse the brief for a one-command unit, but retain those constraints. Relay upstream reports into dependent briefs. A child cannot assume access to a sibling's context. Use fresh children for follow-up work unless costly live state makes a resume necessary under the mode contract.

#### Steps

1. **Frame.** Define a countable local done predicate, units, dependencies, budget, and explicit external blockers. If one session can finish the work, use Autonomous run instead. Do not define completion as merged PRs under a no-publish grant.
2. **Prepare.** Initialize the authorized local store, write standing orders, and open a local decision trail through pstack-show-me-your-work. Record the current dirty baseline and exclusive paths. Inventory required drivers, services, and configured models before dispatch.
3. **Pilot.** Take one representative unit through brief, implementation, independent execution, read-only review, evidence capture, and local handoff. Fix the brief or verification recipe from that evidence before fan-out. Do not commit or publish to make the pilot look complete.
4. **Dispatch a bounded wave.** The primary starts only ready units within the capacity rules. Reserve capacity for verification. Relay inputs explicitly and keep sibling communication through the primary. A track owner cannot dispatch its own wave.
5. **Drain.** Apply the queue discipline below. Review and verification are explicit work units, not side effects of a completion notification.
6. **Prepare the handoff continuously.** As units verify, record their exact local artifacts and dependency order. Follow Shipping for the contiguous independently verified run. Local integration edits need a scoped owner and fresh checks. No landing, push, branch rewrite, or merge is implied.
7. **Close.** Reconcile every dispatched child to completed, blocked, stopped, or abandoned. Check the predicate against actual artifacts and receipts. Report any remaining driver, cloud, hosted-review, admission, or ownership-recovery gaps. Retain the store and decision trail.

#### Queue and drain

- Treat a completion as a queue event. Record its report pointer with `orch inbox push`. Do not interrupt a critical write to review a diff.
- Drain after a critical section, a wave, an approved scheduled wake, and before a human report. Inspect pending pointers with `orch inbox drain --peek`, then preserve the consuming drain's output in the trail.
- Classify each unit as needing verification, verified locally, blocked, failed, or abandoned. Update units and eligible ledger rows. Regenerate status. Account for every child before refilling capacity.
- Dispatch independent verification as a separate primary-owned unit. A worker's self-report is input, not an independent verdict.
- End the drain with counts, changes, and open gates from local records. `orch status` ledger counts include recorded verdicts, not proof that every current artifact has an accepted verdict.

#### Verification and stack safety

For every candidate artifact, the primary commissions pstack-no-comments critique through a read-only reviewer within the two-child cap. Owners never invoke its spawning step or delegate. Relay accepted fixes to the scoped owner and refresh affected evidence.

Independent items require a stable isolated verification artifact containing the recorded baseline plus only that item. Retain the artifact and identify all build inputs, including relevant untracked files, dependency state, and check configuration. Do not treat a shared dirty checkout as isolated because writers own disjoint files. If parallel isolation cannot preserve pending work safely, serialize preparation and verification using stable retained artifacts. Do not implicitly stash, reset, delete, or commit for isolation. If a safe artifact cannot be prepared, mark the item `BLOCKED`. Combined dependent artifacts belong only in Autopilot-stack, with explicit parent identities.

Split execution from review. The primary dispatches a nonauthor `poteto-agent` runner for bounded checks, with the appropriate exact policy task model, normally `implementation`. Record the runner identity and evidence that it did not author or fix the item. Permit only named checks and scoped generated outputs, not source fixes. Freeze source inputs during execution and review. Retain before-and-after identities, commands, output, and tool errors. If no capable permitted nonauthor runner is available, mark required execution `BLOCKED`.

Then dispatch an independent `poteto-reviewer` to inspect the actual artifact, diff, and runner receipts using the configured review task model. The reviewer must not have authored or fixed the item. Record author and reviewer identities with their scoped write receipts. Its agent policy allows read tools and limited Git inspection, not general shell, Playwright, or PTY execution. Code Mode does not bypass those limits. Tool availability and model selection do not grant permission. Do not ask the reviewer to run the checks. The artifact must be accessible through its permitted read tools. A manifest alone does not expose the diff. If actual artifact access is unavailable, mark review `BLOCKED`. Distinct variants or contexts are not distinct models. Report missing diversity without inventing a fallback.

The permitted runner drives user-facing behavior through Playwright for web apps, an owned PTY for interactive CLIs, or an installed driver for IDE or mobile work. Required missing drivers block the lane. Record the base ref, head SHA where applicable, uncommitted content digests, runtime inputs, and reviewer verdict. A screenshot, author summary, or green CI alone is not independent live proof.

For existing PRs, use only the CLI's supported verdicts. They are `live-ui-verified`, `unit-test-verified`, `type-check-only`, `verifier-blocked`, and `verifier-failed`. The primary records the independent verifier's evidence. The CLI does not enforce reviewer independence or prevent an author overwriting a row. Check the receipts yourself. Behavioral acceptance needs more than type checks. Blocked is not passed.

Any changed base, patch, local content digest, or environment invalidates affected evidence. Shipping decides the local handoff ceiling. Do not reuse a SHA-only verdict for a dirty checkout. Keep one writer for stack order. No child rebases, retargets, publishes, merges, or performs stack surgery. If the program requires cloud isolation or hosted Bugbot, stop the dependent lane until that actual service is provisioned and authorized. Local review is not hosted Bugbot parity.

#### Liveness, schedules, and recovery

- Probe owned workers through the discovered runtime status and message operations. Native child results and actual tool receipts are evidence. Do not resume a child merely to check liveness, or infer liveness from file timestamps.
- For scheduled drains, the primary uses `pstack.loop` only with explicit approval, a stop predicate, `intervalSeconds`, `maxRuns`, and `durationSeconds`. Cancel on completion or stop. Do not create nested schedules or another polling loop. The server must remain running. Uncertain dispatch pauses for inspection.
- Bound retries to two per unit. Inspect tool errors before retrying. Missing or rejected policy models stop dispatch. Silence is not quiescence. An uncertain start or still-running writer blocks replacement until execution, writer ownership, retained resources, and capacity are reconciled with actual receipts. Never run overlapping replacements on one scope.
- After restart, reread standing orders and local state. Inspect actual runtime records before declaring a child dead or starting a replacement. Worker ownership does not transfer automatically and recovery/transfer is not implemented. A new session cannot adopt another session's workers from a stored ID. Stop dependent work and request an authorized handoff when owner access is unavailable.
- On stop, halt new dispatch and scheduled wakes, issue zero-write holds to active children, and record their state. Use only supported owned-worker stop procedures. Keep uncertain acquisitions and artifacts for inspection. Do not force-remove worktrees or containers as recovery.

#### Escalation and reply

Park permission gates, unavailable drivers or services, uncertain resource ownership, and program-level dead ends in local state. Route unrelated ready work around them. A broad autonomy grant never overrides forbidden paths, external-write gates, or no-commit/no-push.

At checkpoints and close, report the predicate and count, each track's local artifacts, dependency order, independent verdicts and receipts, abandoned units, open gates, store path, and trail path. Include only PR links actually read or supplied. Separate static checks, executed behavior, and unverified parity.
