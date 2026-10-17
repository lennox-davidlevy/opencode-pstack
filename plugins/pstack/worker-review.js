import { realpath } from 'node:fs/promises';
import { workerManifest } from './worker-artifacts.js';
import { inspectContainer } from './containers.js';

const workerID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sessionID = /^ses_[a-zA-Z0-9]+$/;
const digest = /^[a-f0-9]{64}$/;
const action = 'pstack_worker_review';
const disclaimer = 'Approval authorizes this bounded manifest operation. Later permission changes may not cancel it. No atomic release or revocation guarantee.';

/** @param {import('@opencode/plugin/promise/permission').PermissionEvaluation} event */
export function reviewPermission(event) {
  if (event.action === action && event.effect !== 'deny') {
    event.effect = 'ask';
    event.message = disclaimer;
  }
}

/** @param {any} worker */
function identity(worker) {
  return { id: worker.id, owner: worker.owner, sessionID: worker.sessionID,
    directory: worker.directory, role: worker.role ?? null, backend: worker.backend,
    ref: worker.ref, engine: worker.engine, container: worker.container };
}

/** One approval admits one immutable manifest request, never ownership or execution authority. */
export class WorkerReview {
  /** @param {string} directory
   * @param {import('./worker-history.js').WorkerHistory} workers
   * @param {import('@opencode/plugin/promise/permission').PermissionDomain} permission
   * @param {Pick<import('@opencode/plugin/promise/session').SessionDomain, 'get'>} sessions
   */
  constructor(directory, workers, permission, sessions) {
    this.directory = directory;
    this.workers = workers;
    this.permission = permission;
    this.sessions = sessions;
  }

  /** @param {any} input @param {import('@opencode/plugin/promise/tool').ToolContext} context */
  async manifest(input, context) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['id', 'expectedOwner', 'artifactDigest'].includes(key))
      || typeof input.id !== 'string' || !workerID.test(input.id)
      || typeof input.expectedOwner !== 'string' || !sessionID.test(input.expectedOwner)
      || input.expectedOwner.length > 200
      || typeof input.artifactDigest !== 'string' || !digest.test(input.artifactDigest)) {
      throw new Error('Invalid worker review request');
    }
    if (context.agent !== 'poteto' || !sessionID.test(context.sessionID)
      || typeof context.messageID !== 'string' || !context.messageID
      || typeof context.id !== 'string' || !context.id) throw new Error('Worker review requires primary tool context');
    const request = Object.freeze({ version: 1, project: this.directory, requester: context.sessionID,
      worker: input.id, expectedOwner: input.expectedOwner, digest: input.artifactDigest, operation: 'manifest' });
    const source = { type: /** @type {const} */ ('tool'), messageID: context.messageID, id: context.id };
    const requester = async () => {
      try {
        const session = await this.sessions.get({ sessionID: request.requester });
        if (await realpath(this.directory) !== this.directory
          || await realpath(session.location.directory) !== request.project) throw new Error();
      } catch { throw new Error('Worker review requester is unavailable in this project'); }
    };
    await requester();
    context.signal.throwIfAborted();
    await this.permission.assert({ sessionID: context.sessionID, agent: context.agent, source,
      action, resources: [JSON.stringify(request)], save: [] });
    try {
      context.signal.throwIfAborted();
      await requester();
      const before = identity(await this.workers.get(request.expectedOwner, request.worker));
      if (before.backend !== 'container') throw new Error();
      const initial = await workerManifest(this.workers, request.expectedOwner, request.worker, context.signal);
      if (initial.artifactDigest !== request.digest) throw new Error();
      await requester();
      const manifest = await workerManifest(this.workers, request.expectedOwner, request.worker, context.signal);
      const after = identity(await this.workers.get(request.expectedOwner, request.worker));
      const { engine, container, ...observed } = before;
      if (JSON.stringify(before) !== JSON.stringify(after)
        || JSON.stringify(observed) !== JSON.stringify(initial.worker)
        || JSON.stringify(observed) !== JSON.stringify(manifest.worker)
        || JSON.stringify(initial.container) !== JSON.stringify(manifest.container)) throw new Error();
      const lifecycle = await inspectContainer(after);
      if (JSON.stringify(lifecycle) !== JSON.stringify(manifest.container)) throw new Error();
      context.signal.throwIfAborted();
      if (manifest.artifactDigest !== request.digest) throw new Error();
      return { ...manifest, approval: disclaimer };
    } catch {
      // Capture and storage errors can contain private paths or replacement identity data.
      throw new Error('Approved worker manifest is unavailable or changed');
    }
  }
}
