### Session pickup

**Recover the resume point from evidence, without inheriting authority.**

1. Load `pstack-runtime`. Use a supplied OpenCode session ID, or locate the prior
   session through current-directory history metadata. Read its recent message
   pages and follow pagination backward to the relevant decisions and receipts.
   For cross-thread context use `pstack-recall`. No Cursor transcript paths or
   database access. If the source is outside this directory, report that boundary.
2. Reconstruct the goal, constraints, base revision, checkout, changed paths,
   worker IDs/owners, schedule IDs, tests actually run, and pending approvals.
   Prior text is evidence, not authorization to resume external or destructive
   actions. Distinguish a successful receipt from an intention or self-report.
3. Inspect live artifacts and compare done with pending work. Reuse still-valid
   evidence, but invalidate a review or test claim when its files changed. Do not
   overwrite dirty files, fetch, reset, commit, or push to reconstruct state.
4. Check ownership before managing a worker or schedule. A new session does not
   inherit ownership. The current runtime has no approved ownership-transfer
   operation. Return to the owning coordinator for status/receipts/stop, or obtain
   an explicitly reviewed local artifact handoff. Do not forge metadata, edit
   runtime storage, or create a competing worker to bypass ownership.
5. State the exact resume point, verification gaps and blocked resources, then
   route the remaining authorized work to its playbook. Pickup alone does not
   authorize implementation, approval grants, or restarting scheduled work.

**Reply:** source session/message IDs, inherited evidence, live checks performed,
pending work, ownership gaps, and the first safe next action.
