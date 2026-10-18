---
name: principle-migrate-callers-then-delete-legacy-apis
description: "Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers."
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

# Migrate Callers Then Delete Legacy APIs

- Update tests to assert the new contract, and delete tests that only protect pre-refactor implementation details

**When this applies:**
- No external users depend on backward compatibility
- The project can absorb coordinated breaking changes
- The new API is part of a simplification or refactor initiative
