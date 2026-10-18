### Multi-phase or multi-PR plan

**You own the plan, not the code. The plan is a checklist an owner runs box by box and the operator audits from the evidence.** The plan is the deliverable. Do not implement.

Plan a verified local handoff. Never commit or push, including through wrappers. External writes need separate specific authorization, which cannot lift this suite's no-commit/no-push rule. Only the primary dispatches owners, nonauthor execution runners, and read-only reviewers. Enforce a hard aggregate maximum of two active children across all those roles, including comment review. Configuration and pilots cannot raise it. Retained resources and uncertain acquisitions count until reconciled.

1. When the change is one or two files with an obvious approach, skip the plan. Say so and stop.
2. Use existing prototype evidence to settle open questions. Keep exact local artifact identities and screenshots for Appendix A. If a new prototype needs writes beyond the plan grant, record it as a blocked prerequisite rather than implementing it here. Ask the operator only about a product or preference call that no run can settle. Give options (the **never-block-on-the-human** principle skill).
3. The primary may dispatch bounded read-only exploration using the `investigation` task's exact policy model and the appropriate role per the Subagents section (the **guard-the-context-window** principle skill). A child planner returns evidence gaps instead of delegating. Each explorer returns file pointers, conventions, test commands, and entry points. No inlined dumps.
4. Copy the skeleton below into an authorized project-local plan path and fill every placeholder. Do not assume a shared agent store. Keep every heading and every sub-block in the order shown. One section per proposed PR or local item, with its own evidence (the **sequence-verifiable-units** principle skill). Name the execution playbook in **How to read this**. Pick `playbooks/autopilot-full.md` for independent isolated items or `playbooks/autopilot-stack.md` for a dependent chain. A standing program takes `playbooks/orchestrate.md`.
5. Write under pstack-technical-writing in full, then pstack-unslop. The body is one Diátaxis mode, how-to. Appendices hold explanation and reference. Each heading states the task or the finding. No long dashes. No mid-sentence colons.
6. Resolve and inspect `scripts/check-plan.mjs` from the loaded `pstack-poteto-mode` skill's absolute base directory. When execution is authorized, run `node "<absolute skill directory>/scripts/check-plan.mjs" "<plan.md>"` and fix every line it prints (the **encode-lessons-in-structure** principle skill). Under a static-only grant, check its source requirements without executing it and report the unrun validation. Its legacy PR and Merge headings do not grant publication authority.
7. Hand back. Post the plan path and actual script output, or label static validation and the unrun check, then stop. Execution starts on the operator's explicit go, under the execution playbook the plan names.

**Verification.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked (the **prove-it-works** principle skill). That sentence is the verification rule. Every verification block opens with it. The live block is mandatory. Plan ten concrete scenarios, each with a saved screenshot and a pass predicate. Ten lanes describe coverage, never permission for ten concurrent children. Run them in waves within the aggregate cap of two. The primary dispatches permitted nonauthor poteto-agent runners, normally on the `implementation` task model, then independent poteto-reviewer children to read the exact artifacts, diffs, and receipts. Record nonauthor identities. Reviewers cannot run general shell, Playwright, or PTY checks, even when those tools are available. Missing capable permitted runners or required drivers leave the checks `BLOCKED`.

One scenario is the **Regression lane against trunk.** Run the same load-bearing scenario on trunk and the candidate artifact. If trunk lacks the feature, record that and gate the behavior added plus the user's end state instead of inventing a trunk result. The perf gate is dual-sided. Both artifacts must produce the named metric. If trunk lacks the feature, isolate the work added and set absolute budgets for that work and the end-to-end state. Do not claim a ratio between unlike scenarios. Name the metric, interleaved probe, measured baseline, and failing threshold. Interaction changes require operator review in chat with screenshots and video before local acceptance. With no interaction change, write `**Review gate.** None. <PR id> is not review-gated.` and no boxes under it. Required hosted Bugbot or cloud verification remains `BLOCKED` without the actual provisioned, authorized service. Local checks are not service parity.

**Drivers.** Pick by surface. Permitted runners use Playwright for web interaction, an owned PTY for interactive CLIs, or an installed IDE or mobile driver. A change touching two surfaces gets scenarios on both. Missing drivers are blockers in Appendix C and the affected live boxes stay unchecked. Offline containers are not cloud VMs. A container runner has only its backend's actual tools, not host Playwright or PTY access.

````markdown
# <Program> plan

<Under ten lines. What changes, for whom, the rule the program enforces, and the PR ids in order.>

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `<absolute pstack-poteto-mode skill directory>/playbooks/<execution playbook>.md`. <Name the local handoff boundary. Never commit or push, including through wrappers. External writes need separate specific authorization and cannot lift that rule.>

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read the installed skills at program start. Resolve each base directory through the skill tool, not from the target project's Git tree.
  - [ ] `<absolute pstack-poteto-mode skill directory>/playbooks/<execution playbook>.md`
  - [ ] Load `pstack-swarm`.
  - [ ] Read the available surface-verification instructions.
  - [ ] `<absolute pstack-poteto-mode skill directory>/playbooks/opening-a-pr.md`
  - [ ] Load each other `pstack-` leaf skill the program uses.
- [ ] On the operator's go, perform a bounded audit with the tick prompt below in the active session. Record a stopping condition. Only the primary may request approved `pstack.loop` scheduling with `intervalSeconds`, `maxRuns`, and `durationSeconds`. The server must remain active. Cancel on completion, stop, or expiry. Uncertain dispatch pauses for inspection. Never nest schedules or add another polling loop.
- [ ] Use this tick prompt, verbatim. "Re-read the current project-local execution playbook and standing orders. Audit drift using actual owned execution receipts and artifact identities. Silence is not quiescence. Hold a stuck lane and reconcile execution, writer ownership, retained resources, and capacity before replacement. Only the primary dispatches, with a hard aggregate maximum of two active children across owners, runners, and reviewers. Post a short status message only for newly observed tracked changes, verdicts, blockers, or operator decisions. Name each change without repeating unchanged status. If none changed, end with no reply text. Log every audit in the local decision trail, including audits with no changes. Do not commit, push, publish, or treat uncertain capacity as released."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] The primary dispatches one bounded owner per item within the hard aggregate cap of two across owners, runners, and reviewers. No child delegates or starts schedules.
- [ ] Follow this dependency graph. Independent items verify on isolated baseline-plus-only-item artifacts. Dependent combined artifacts use Autopilot-stack and name the exact retained parent input.
  - [ ] <PR id> and <PR id> are independent and first. Each starts from the recorded trunk baseline without sibling changes.
  - [ ] <PR id> after <PR id>.
- [ ] Hold the file boundaries. <PR id or class> touches only `<glob>`.
- [ ] Hold the review gate. <PR ids> change an interaction. They wait for the operator's review in chat with screenshots and a video before local acceptance.

### PR mechanics, for every PR

- [ ] Record existing PR metadata only through authorized forge reads. Missing access does not block unrelated local preparation. Never require `gt`.
- [ ] Prepare a local title, description, intended base, and artifact identity per **Opening a PR**. Do not open or mutate a remote PR under the local grant.
- [ ] Run the repo's bounded lint and typecheck against the exact candidate and retain output. Do not commit or push.
- [ ] Owners run pstack-unslop. After the candidate exists, the primary commissions pstack-no-comments critique within the aggregate cap. Owners never invoke its spawning step. Return accepted fixes to the scoped owner and refresh affected evidence.
- [ ] Triage supplied or authorized observed Bugbot and security-reviewer comments per `../references/bugbot-triage.md`. Retain draft replies locally. Required hosted review remains blocked without that service.
- [ ] Record baseline drift before code-ready acceptance. Follow Shipping's artifact rules for safe preparation and fresh checks, not implicit rebase or publication. Preserve pending dirty work without implicit stash, reset, deletion, or commit. If isolation is unsafe, serialize preparation and verification using stable retained artifacts. Block if no safe artifact can be prepared.

### Verdict and merge, for every PR

- [ ] Run full planned coverage on the code-ready artifact and again for new behavior, redesign, or a large new diff. Run affected checks for minor fixes or drift. The primary dispatches nonauthor poteto-agent runners for execution and independent poteto-reviewer children for read-only artifact and receipt audits, in waves of at most two total active children including owners. Reviewers never run general shell, Playwright, or PTY checks. Record each runner's nonauthor identity and permitted tools. Block without a capable permitted runner.
- [ ] Accept only when every required lane passes and every finding has a disposition. Source inputs stay frozen during execution and review. Record before-and-after input identities, commands, output, and reviewer verdicts. New content needs fresh evidence under `playbooks/shipping.md`, not SHA or patch equality alone.
- [ ] <The local independent-item or contiguous-stack handoff rule from the execution playbook and Shipping. Keep external publication as an unexecuted operator plan.>

### Boot recipe, for every live lane

Each live scenario runs against its exact stable retained artifact through a permitted nonauthor runner. Reviewers read the artifact and receipts afterward. Plan ten scenarios, not ten simultaneous agents. Use waves within the hard aggregate cap of two. Mandatory cloud isolation requires an actual provisioned and authorized backend or stays `BLOCKED`. Local workers and offline containers are not cloud VMs.

- [ ] <Identify the retained baseline-plus-only-item artifact, or the explicit dependent parent-plus-item artifact under Autopilot-stack. Verify input digests before boot. Do not fetch or overwrite pending dirty work to prepare it.>
- [ ] <Start the backend and the surface. Wait for ready.>
- [ ] <Deliver input through permitted Playwright, owned PTY, or the installed driver. Name the bounded diagnostics and generated-output paths. Missing drivers block the scenario.>
- [ ] Save screenshots and receipts in `<authorized local evidence directory>/<item-id>/lane-<n>/` and return exact paths with input identities and output. Keep artifacts stable and retained for review.

## <Task as a verb phrase> (<PR id>)

**Depends on.** <PR id, or None.>

**Files.**

- [ ] Edit `<path>`.
- [ ] Create `<path>`.
- [ ] Delete `<path>`.

**Build.**

- [ ] <One change. Name the symbol and the file.>

**You see.**

- [ ] <One observable result, with the exact log line or screen state.>

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] <Test file and the case it gains.> Run `<command>`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `<implementation task model>` at the PR head, per the boot recipe. PR head means the exact local candidate identity, including uncommitted content. Run these scenarios in waves within the aggregate two-child cap, never ten concurrent agents.

- [ ] Lane 1. Regression lane against trunk. Run <the same load-bearing scenario> at trunk and head. If trunk lacks the feature, record that and gate <the behavior the diff adds plus the end state the user waits for>. Save `<slug>.png`. Pass when <predicate>.
- [ ] Lane 2. <Scenario.> Save `<slug>.png`. Pass when <predicate>.
- [ ] Lane 3. <Scenario.> Save `<slug>.png`. Pass when <predicate>.
- [ ] Lane 4. <Scenario.> Save `<slug>.png`. Pass when <predicate>.
- [ ] Lane 5. <Scenario.> Save `<slug>.png`. Pass when <predicate>.
- [ ] Lane 6. <Scenario.> Save `<slug>.png`. Pass when <predicate>.
- [ ] Lane 7. <Scenario.> Save `<slug>.png`. Pass when <predicate>.
- [ ] Lane 8. <Scenario.> Save `<slug>.png`. Pass when <predicate>.
- [ ] Lane 9. <Scenario.> Save `<slug>.png`. Pass when <predicate>.
- [ ] Lane 10. <Scenario.> Save `<slug>.png`. Pass when <predicate>.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. <What is measured at both trunk and head. If trunk lacks the feature, also name the diff-added work and the end-to-end state the user waits for.>
- [ ] Probe. <The command or procedure, run at trunk and at the head, interleaved. Both sides must produce the metric.>
- [ ] Baseline. Record the trunk <value> first.
- [ ] Rule. <Head against trunk, with the number that fails. If the scenarios differ, add absolute budgets for the diff-added work and the user-visible end state instead of an invalid ratio.>

**Review gate.** The operator reviews before local acceptance.

- [ ] Copy lane <n> screenshots into `<media path>/<pr-id>-review-<slug>.png`.
- [ ] Record a 30 to 60 second video through a permitted runner on the verified artifact. Save it as `<media path>/<pr-id>-review.mp4`. Missing recording capability leaves the gate blocked.
- [ ] Show screenshots and video to the operator in chat within the authorized handoff. Do not upload externally without specific approval. Wait for review without committing, pushing, or merging.

**Merge.**

- [ ] Primary's accepted independent verdict at the exact local artifact identity.
- [ ] Required Bugbot triage done against actual hosted evidence, or marked blocked. Local review is not hosted review.
- [ ] Artifact and baseline identities still match accepted evidence under Shipping's drift rules.
- [ ] <Local handoff only. Name the independent artifact or contiguous verified stack ceiling. The legacy Merge heading authorizes no commit, push, or remote operation.>

## Close the program

- [ ] Reconcile every box with evidence or an explicit blocker. Unchecked required boxes prevent a verified-completion claim. Retain artifacts, cancel approved schedules, and reconcile every child's resources and writer state.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

<Each open question existing prototype evidence answered, with exact local artifact identities and links. Each question that stays unproven or blocked.>

## Appendix B. Alternatives rejected

<Each approach weighed and why it lost.>

## Appendix C. Risks

<Each risk with the PR it lands in and what the owner watches.>

## Appendix D. Links and reading list

<Docs to read before editing. Which units load `pstack-how` and `pstack-interrogate`. The trail follows `pstack-show-me-your-work`.>
````

**Reply.** Give the plan path, item ids and dependencies, review-gated set, existing prototype evidence and unproven questions, and actual validation output or the explicitly unrun check. Separate local handoff from blocked external capabilities.
