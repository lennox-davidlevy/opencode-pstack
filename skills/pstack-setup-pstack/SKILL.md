---
name: Setup pstack for OpenCode
description: Configure poteto and its delegates using available OpenCode models, not Cursor model slugs or rules.
---

# Setup pstack on OpenCode V2

This replaces Cursor's setup-pstack workflow. Never write a `.cursor` rule.

1. Read the active OpenCode configuration and the authoritative Markdown agents
   in this bundle's `agents/` directory (`.opencode/agents/` when installed).
   Fetch the V2 agents and configuration documentation before changing them.
2. Discover available provider/model IDs and supported variants through the
   exposed OpenCode models tool or `opencode models`. Do not invent IDs or
   translate Cursor effort suffixes into model names.
3. Ask which models the user wants for primary coordination, implementation
    (`poteto-agent`), review (`poteto-reviewer`), and source investigation
    (`poteto-investigator`). Report their current effective models first; this
    bundle explicitly configures all four rather than defaulting to inheritance.
    Offer only discovered IDs and variants, plus inheritance for child agents.
    Do not silently require extra providers.
4. Show the proposed mapping and confirm project-local versus global scope.
    Update these agents' `model` fields in their authoritative Markdown
    frontmatter, not duplicate JSON role definitions. A model uses
    `provider/model#variant`; remove the field from the Markdown for child
    inheritance. Inspect matching global/project definitions for additional
    model fields: omission does not erase an inherited value. Do not edit a
    global definition or follow a global symlink for writes without approval.
    Preserve unrelated configuration, prompt bodies, modes, and permissions.
5. Verify the effective roles through the running server's `/api/agent` endpoint
    with the target directory supplied explicitly in the location query. Require
    the requested effective model, or its absence for child inheritance; if an
    inherited definition still sets it, report that conflict rather than claiming
    inheritance. Explain that selecting a primary
   agent does not change an existing session's stored model. The user must
   select the desired session model too. Child agents use their configured
   model or inherit the parent's when omitted.
6. Report the effective mapping. Multi-model arena/interrogate panels need
   explicitly requested, discovered model overrides per child. A fresh child
   on the same model gives an independent context, not model diversity.

Optional verification workflows use `pstack-create-verification-skill`. Do not
create one or install integrations without the user's request. Never commit
or push configuration changes.
