### Authoring or modifying a skill

**You own the skill's voice.**

1. Use OpenCode V2 SKILL.md frontmatter and the local **technical-writing** and **unslop** skills. Read relevant leaf principles. Change generated host contracts through `prompts/pstack-compatibility.md`, then run the inspected `python3 scripts/sync_contract.py` from the bundle root.
2. Validate the skill: frontmatter has `name` and `description`, referenced files exist, cross-skill links resolve.
3. Test cases if structural. Skip if subjective.
4. Run **Opening a PR**.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
