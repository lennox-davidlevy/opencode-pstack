### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. `how` over the affected subsystem.
2. `architect` for parallel design exploration.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. The primary delegates code-writing using the project policy's `implementation` task, or `hard` for difficult work, with specific file paths, a named data shape per **principle-model-the-domain**, and observable success criteria. Keep the exact policy model and variant. For materially different designs, the primary runs the **arena** workflow within the hard two-child aggregate cap. Children return their own candidate artifact and do not delegate. The primary commissions independent review. Keep edits surgical and verify affected consumers of shared primitives. Do not commit or push.
5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Preserve small, ordered local artifacts and their verification receipts without rewriting branches or committing.
   Use **principle-sequence-verifiable-units** to verify each unit before the next.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR**.

Code-coupled work goes to a single owner with the checkpoint inline. Only the primary dispatches follow-up work and independent verification. Disjoint writes do not isolate verification inputs. Keep each tested artifact stable and preserve unrelated dirty work. Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
