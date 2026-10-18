---
name: principle-foundational-thinking
description: "Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious."
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

# Foundational Thinking

**Structural decisions** protect option value. **Code-level decisions** protect simplicity.

**Data structures first.** Get the data shape right before writing logic. Define core types early, trace every access pattern, and choose structures that match the dominant paths.

At code level, DRY the structure, not every line. Types and data models should converge. Three similar statements still beat a premature abstraction. Prefer explicit over clever. Test behavior and edge cases, not line counts.

**Concurrency corollary.** Before sharing state between actors, ask "what happens if another actor modifies this concurrently?" If not "nothing", isolate.

**Scaffold first.** If something helps every later phase, do it first. Ask "does every subsequent phase benefit from this existing?" CI, linting, test infrastructure, and shared types are scaffold. Sequence for option value: setup before features, tests before fixes. Keep commits small and single-purpose.

Each increment should land a coherent abstraction or deepen one that exists. Do not spread a new capability across callers as special-case coordination.

Subtraction comes before scaffolding. Remove dead code first, then lay foundations.
