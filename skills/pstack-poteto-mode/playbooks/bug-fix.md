### Bug fix

**You own this task. Plan, review, verify.** Delegate investigation and the fix to subagents, stay in the lead. Select each task profile and exact policy model per the Subagents section.

Be scientific. Every shipped line traces to runtime evidence. Belt-and-suspenders that "might help" is a hypothesis, not a fix. It does not ship. When evidence refutes a hypothesis, revert what it motivated. The smallest change the evidence justifies ships, nothing more.

1. Reproduce it yourself on the matching surface via the control skill (Non-negotiables), even when a debug or instrumentation protocol says to ask the user to reproduce. Ask the user only with a stated, specific reason the control surface cannot reach the target, and only after driving it as far as it goes. If it won't reproduce directly, synthesize the trigger, tighten conditions, or instrument until it fires.
2. Binary-search the cause. Form candidate hypotheses and rule them out with runtime evidence. Seed them with **how** over the subsystem and **why** for regression history. Instrument unclear state rather than guessing. For unattended checks, only the primary may request a bounded `pstack.loop` schedule with explicit approval, a stop predicate, interval, maximum runs, and expiry. Follow `pstack-runtime`; do not create nested polling loops. Confirm the surviving mechanism before design fan-out.
3. Plan the fix. If it crosses a function boundary, `architect` first. Delegate implementation with a specific scope using the `implementation` task, or `hard` for difficult work, per project-local `pstack-models.json`.
4. Verify on the same surface. The original repro now passes. "Inconclusive" or wrong-surface is not a pass. Flag it. Unit tests show branch behavior, not bug absence.
5. Preserve failing-then-passing repro receipts and the local fix artifact. Do not stage, commit, or push. See **tdd** for the failing-test-first cadence when a cheap local test exists. For expensive or unavailable surfaces, record the coverage limit explicitly.
   This is the canonical **sequence-verifiable-units** principle skill, the failing test first and the fix on top.
6. Run **Opening a PR**.

**Reply:** what was broken, root cause, fix, how you verified. Paste failing-then-passing repro output verbatim.
