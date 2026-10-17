### Pause safely

**Leave a durable local checkpoint without committing or discarding work.**

1. Stop admitting new work at an atomic boundary. Do not revert unfinished edits
   merely to make the tree clean. Record incomplete operations honestly.
2. List and cancel this session's owned schedules through `pstack.loop`. An
   admitted wakeup cannot be retracted by cancelling its future schedule. Record
   any already-admitted turn. Do not silently leave a recurrence armed.
3. Record every owned worker ID and session ID. Stop owned active workers through
   `pstack.worker`; close owned PTYs. Preserve clones, worktrees, files and logs.
   If a stop fails, report the live resource and failure instead of claiming a
   clean pause. Never stop another session's resources without specific authority.
4. Write a local resume note to an agreed project path or a named path under
   `/tmp/opencode`. Include the goal, constraints, base SHA, modified and untracked
   paths, worker checkout locations and ownership, schedule state, verification
   receipts, incomplete steps, and the first safe next action. Save paths to any
   existing decision trail rather than duplicating it. Do not include credentials.
5. Read the checkpoint back and check that referenced artifacts exist. Leave all
   changes uncommitted. No WIP commit, push, PR, cleanup, or automatic deletion.

**Reply:** checkpoint path, preserved files, stopped and still-active resources,
what remains unverified, and the resume action. This is a pause, not completion.
