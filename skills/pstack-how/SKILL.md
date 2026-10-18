---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
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
> `pstack-principle-test-behavior-not-implementation`. Heavy test/build runs go through
> `scripts/gated-run.sh` (memory, task and time caps plus leftover checks).
<!-- opencode-host:end -->

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Every spawn is a Task subagent with `subagent_type: generalPurpose` and `readonly: true`. Explorers use the `how explorer` line in the `pstack-models.mdc` rule (default `grok-4.7-xhigh-fast`), and every explainer uses the `how explainer` line (default `claude-opus-5-5-xhigh`). Set `model` to that line's value, or to the default if the rule or the line is missing. Leave `model` unset when the value is `auto` or `inherit-parent`. If the Task tool rejects a slug, use the default and say so. If it rejects the default, use the closest valid slug of the same family from its error message. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.

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
