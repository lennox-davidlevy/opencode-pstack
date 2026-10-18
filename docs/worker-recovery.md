# Worker recovery boundaries

Worker lifecycle integration has passed bounded local checks. This page describes
its conservative recovery contract, not a completed migration or recovery tool.

## Preserve uncertain work

A failed or cancelled start can still have an outstanding request on the host
server or container daemon. That worker keeps its capacity charge. A missing
reply or a currently absent container is not proof that creation cannot resume.

Use the owning session's worker list and status operations to obtain the worker
ID, lifecycle state, resource states, and failure receipts. Follow list cursors
until the relevant records are covered. A degraded listing must identify omitted
legacy results. Do not infer ownership from a path or copy another session's ID
into a start request.

Do not delete the admission directory, its lock, worker records, sessions, clones,
or containers to regain capacity. Do not start a replacement while the previous
writer or its deferred requests may still execute. Preserve the worker's files
and record the failure before requesting a scoped operator reconciliation.

## Normal stop and interrupted cleanup

The intended normal stop path cancels the identified queued input, interrupts
the session on its authoritative server instance, stops the owned container when
applicable, and evicts only the dedicated worker location. It retains session
history and checkout files. Capacity release requires verified terminal resource
states and no outstanding creation or cleanup producer.

An interrupted cleanup can itself leave a remote request outstanding. Repeating
stop must not issue competing requests or clear the charge based only on elapsed
time. Record the original failure and any bookkeeping failures together.

## Legacy workers and server changes

Records created before the admission ledger block new worker starts until they
are explicitly reconciled. They are not silently treated as stopped. Automatic
legacy import, ownership transfer, and stale-lock recovery are not implemented.

A new server process cannot certify that the old process stopped a worker just
because interruption returns false. Execution ownership and producer quiescence
need independent evidence. Do not restart the shared server as a cleanup shortcut.

Operator reconciliation must establish that all relevant producers have settled
and cannot resume, verify each owned resource, and preserve artifacts and history.
Any destructive action or external-service operation needs specific approval.
Direct ledger editing is not a supported recovery command.

## Scope of the limits

Participating locations must share one canonical admission directory and matching
limits. The default directory is bundle-local `.pstack-state/admission`. The
default limits are two charged workers and 100 retained records. These limits
do not bound unrelated installations, native subagents, arbitrary global plugins,
or all memory used by the shared host. Never describe them as a machine-wide
memory cap.

Do not publish ledger contents as a debugging shortcut. Runtime plans can contain
task text and permission details. Share only the minimal redacted receipts needed
for the approved investigation.
