---
name: Poteto help for OpenCode
description: Explain poteto's pstack workflows, setup, skill selection, and OpenCode limitations without starting the work.
disable-model-invocation: true
---

# Poteto help

Answer the user's question, offer one concrete prompt, and cite the local file
you read. A help request does not authorize an implementation run.

Read [the OpenCode port guide](../../docs/pstack-port.md) for installation,
supported tools, safety boundaries, and limitations. Select the `poteto`
primary agent for the full workflow. It loads `pstack-poteto-mode` before
substantive work. No Cursor Custom Mode, `/add-plugin`, or `.mdc` rule is used.

Skills are invoked with OpenCode's `skill` tool or `@pstack-<name>` in a user
message. Read the relevant SKILL.md before describing its detailed workflow.

| Need | Skill ID |
| --- | --- |
| Coordinate a nontrivial task | `pstack-poteto-mode` |
| Configure available models | `pstack-setup-pstack` |
| Explain current code | `pstack-how` |
| Investigate rationale/history | `pstack-why` |
| Teach a subsystem | `pstack-teach` |
| Restate the goal / improve a brief | `pstack-in-your-own-words` / `pstack-sharpen` |
| Recover context / summarize progress | `pstack-recall` / `pstack-ketchup` |
| Assess impact | `pstack-blast-radius` |
| Compare architectures / implementations | `pstack-architect` / `pstack-arena` |
| Parallel verification / adversarial review | `pstack-swarm` / `pstack-interrogate` |
| Test-first debugging | `pstack-tdd` |
| Scoped comment review | `pstack-no-comments` |
| Improve prose / technical docs | `pstack-unslop` / `pstack-technical-writing` |
| Plain-language explanation | `pstack-bro` |
| Build / maintain verification workflows | `pstack-create-verification-skill` / `pstack-maintain-verification-skill` |
| Validate performance measurements | `pstack-benchmark-checklist` |
| Design a bespoke run / record decisions | `pstack-figure-it-out` / `pstack-show-me-your-work` |
| Capture habits / reflect / encode corrections | `pstack-automate-me` / `pstack-reflect` / `pstack-correct` |

The `pstack-principle-*` leaf skills are routed by poteto-mode. For any skill
not listed here, inspect the available skill catalog rather than inventing it.

Explain that delegation spends additional tokens. Fresh sessions using the
same model do not constitute multi-model consensus. Native browser automation
uses Playwright; CLI checks use shell and existing tests. Cloud agents,
Bugbot, unattended schedulers, private MCP sources, and interactive TUI
drivers are not supplied by this port. Never promise coverage they provide.

Shipping ends with a verified local diff and handoff. Never commit or push.
External writes, destructive actions, production access, and expanded scope
require specific confirmation.
