---
name: principle-attack-the-premise
description: "Apply when two or more fixes that share one premise have failed the same gate. Write the premise down and test it directly before you write another fix that assumes it."
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

# Attack the Premise

When two or more fixes that share one premise have failed the same gate, suspect the premise, not the fixes.

**Why:** Each failed fix is evidence against the belief it assumed. A third fix on the same premise spends effort where the evidence already says the cause is not.

**Pattern:**
- **Write the premise down.** The premise is the one sentence that every failed fix assumed.
- **Test the premise before the next fix.** Find an observation that would come out differently if the premise were false, and make it. Look at how the failures are distributed, not only at how large they are. Make the check rerunnable per [Build the Lever](../pstack-principle-build-the-lever/SKILL.md).
- **Follow the evidence.** If it contradicts the premise, the cause is elsewhere. Look for what the failures have in common that the premise did not predict. If it confirms the premise, ask the next "why" per [Fix Root Causes](../pstack-principle-fix-root-causes/SKILL.md). The earlier fixes may have treated a consequence instead of the cause.
- **Remove the condition instead of compensating for it**, per the [Laziness Protocol](../pstack-principle-laziness-protocol/SKILL.md). If the evidence shows that one part always lands on the losing side, change what puts it there. A mechanism that cleans up after it leaves the cause in place and adds work on every run.

**Stop:** Do not start the next fix before the premise is written down and tested.

This principle is distinct from [Redesign from First Principles](../pstack-principle-redesign-from-first-principles/SKILL.md), which rebuilds a design around a new requirement. It questions a fact the current design assumes.
