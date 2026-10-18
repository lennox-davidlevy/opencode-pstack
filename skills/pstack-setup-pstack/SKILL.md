---
name: Setup pstack for OpenCode
description: Configure the project-local six-task model policy and synchronize OpenCode agent defaults without changing permissions or active sessions.
---

# Set up project task models

Use `pstack-runtime` for delegation. Never write a Cursor rule or change global
configuration as part of project-local setup.

1. Read this bundle's `pstack-models.json`, authoritative `agents/*.md`, and
   `scripts/sync_models.mjs`. Installed bundles keep these under `.opencode/`.
   Read applicable OpenCode configuration and matching global definitions to
   identify conflicts. Do not follow a global symlink for writes.
2. Fetch current OpenCode V2 agent and model documentation. Discover available
   provider/model IDs and supported variants through the exposed models tool or
   `opencode models`. Validate each full `provider/model#variant` value against
   discovery. A plausible name, provider prefix, or error suggestion is not proof
   of availability. Never invent a fallback or translate Cursor effort suffixes.
3. Report the current six-task mapping and agent defaults. Ask for the user's
   choices only when they have not already approved them. Cover `coordination`,
   `implementation`, `hard`, `investigation`, `review`, and `mechanical`. Treat
   `mechanical` as a bounded trial with checks, not a quality or cost guarantee.
   Confirm project-local scope. Do not offer implicit parent inheritance in this
   explicit policy format or require an extra provider without approval.
4. Edit only the approved project policy. Keep `version: 1`, a `tasks` object of
   the six exact model strings, and a `defaults` object mapping `poteto` to
   `coordination`, `poteto-agent` to `implementation`, `poteto-reviewer` to
   `review`, and `poteto-investigator` to `investigation`. Panels use the distinct
   implementation and review models without a separate `panels` key.
5. From the bundle root, run the inspected `node scripts/sync_models.mjs`, then
   `node scripts/sync_models.mjs --check`. The synchronizer updates model fields
   in authoritative Markdown agent frontmatter. Preserve prompt bodies, modes,
   permissions, and unrelated configuration. Do not add duplicate JSON agents.
6. Report static results separately from effective runtime results. With explicit
   permission and a test-owned server, inspect effective agents and verify native
   overrides and worker task resolution without model execution. Never probe or
   restart a shared server just to complete setup. If runtime checks are not
   authorized, mark them pending rather than claiming that routing was exercised.
7. Report the resulting mapping and any configuration conflicts. Native delegates
   select a task and pass its exact policy model to `subagent`. Workers accept
   optional `task` and default by role. Both retain role permissions. The approved
   policy authorizes these choices without another prompt for each call.

An existing session keeps its selected model until the human changes it. Agent
defaults and policy edits do not switch the current session. For multi-model
panels, require distinct provider/model IDs, not only different variants or fresh
contexts. Report gaps instead of substituting unapproved models.

See `docs/model-policy.md` in the bundle for the approved mapping and verification
limits. Optional verification skills and integrations require a separate request.
Never commit or push setup changes.
