import { SessionID } from '@opencode/schema/session-id';
import { SessionMessage } from '@opencode/schema/session-message';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, stat, writeFile } from 'node:fs/promises';
import { join, normalize, parse, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Admission } from './admission.js';
import { workerTransport } from './worker-transport.js';
import { containerOptions, startContainer, inspectContainer } from './containers.js';
import { bootstrapLocalWorker } from './local-worker-bootstrap.js';
import { assertModelAvailable, loadModelPolicy, parseModelRef, resolveModel } from './models.js';

const exec = promisify(execFile);
/** @type {Map<string,Promise<unknown>>} */
const transactions = new Map();
/** @typedef {import('./admission.js').AdmissionRecord} Record */
/** @typedef {import('@opencode/plugin/promise/tool').ToolContext} Context */

/** Refuse aliases before creating any component, including a lazily installed ledger.
 * Cooperating participants are supported, not hostile concurrent directory replacement.
 * @param {string} path */
async function canonicalDirectory(path) {
  if (!isAbsolute(path) || normalize(path) !== path || path === parse(path).root) throw new Error('Canonical dedicated directory required');
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/')) {
    const parent = current;
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if (/** @type {any} */ (error).code !== 'EEXIST') throw error; }
    if (!(await lstat(current)).isDirectory() || await realpath(current) !== current) throw new Error('Unsafe directory alias');
    const handle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  return path;
}

/** @template T @param {string} key @param {()=>Promise<T>} operation @returns {Promise<T>} */
function serialized(key, operation) {
  const pending = (transactions.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  transactions.set(key, pending);
  void pending.finally(() => { if (transactions.get(key) === pending) transactions.delete(key); }).catch(() => {});
  return pending;
}

/** @param {unknown} error */
function receipt(error) { return String(error).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 1024) || 'Unknown worker failure'; }

/** Authenticate the pinned server claim against Linux process and listener evidence.
 * Remote servers, forwarded endpoints and other OSes have no supported proof here.
 * @param {Awaited<ReturnType<typeof workerTransport>>} transport
 * @param {AbortSignal} [signal] @returns {Promise<import('./admission.js').ServerIdentity>} */
export async function originatingServer(transport, signal) {
  return localServerIdentity(await transport.client.server.info({ signal }), transport.endpoint);
}

/** @param {any} info @param {string} [endpoint] @returns {Promise<import('./admission.js').ServerIdentity>} */
export async function localServerIdentity(info, endpoint) {
  if (process.platform !== 'linux' || !Number.isSafeInteger(info?.pid) || info.pid < 1 ||
      typeof info.version !== 'string' || !info.version || !Array.isArray(info.urls) || !info.urls.length ||
      typeof info.paths?.tmp !== 'string' || !isAbsolute(info.paths.tmp) || normalize(info.paths.tmp) !== info.paths.tmp) throw new Error('Unsupported local server identity evidence');
  const ports = new Set(info.urls.map((/** @type {string} */ value) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password) throw new Error('Remote server identity verification is unsupported');
    return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  }));
  if (endpoint !== undefined && !info.urls.some((/** @type {string} */ value) => new URL(value).origin === endpoint)) throw new Error('Discovered endpoint is not advertised by the local server');
  const proc = `/proc/${info.pid}`;
  for (const namespace of ['pid', 'net', 'mnt']) {
    if (await readlink(`${proc}/ns/${namespace}`) !== await readlink(`/proc/self/ns/${namespace}`)) throw new Error('Server is not in the supported local namespaces');
  }
  const uid = (await stat(proc)).uid;
  if (uid !== process.getuid?.()) throw new Error('Server local owner mismatch');
  const tmp = await realpath(info.paths.tmp);
  if (tmp !== info.paths.tmp) throw new Error('Server temporary directory is not canonical');
  const localTmp = await stat(tmp);
  const serverTmp = await stat(`${proc}/root${tmp}`);
  if (!localTmp.isDirectory() || localTmp.dev !== serverTmp.dev || localTmp.ino !== serverTmp.ino) throw new Error('Server temporary directory is not locally corroborated');
  const processStart = async () => {
    const value = await readFile(`${proc}/stat`, 'utf8');
    const fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (!/^[1-9][0-9]*$/.test(fields[19]) || ['Z', 'X'].includes(fields[0])) throw new Error('Server process identity is unavailable');
    return fields[19];
  };
  const start = await processStart();
  const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const sockets = new Set();
  for (const fd of await readdir(`${proc}/fd`)) {
    try { const target = await readlink(`${proc}/fd/${fd}`); const match = /^socket:\[([0-9]+)\]$/.exec(target); if (match) sockets.add(match[1]); }
    catch (error) { if (/** @type {any} */ (error).code !== 'ENOENT') throw error; }
  }
  const listeners = new Set();
  for (const family of ['tcp', 'tcp6']) {
    for (const line of (await readFile(`${proc}/net/${family}`, 'utf8')).trim().split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] === '0A' && sockets.has(fields[9])) listeners.add(parseInt(fields[1].split(':')[1], 16));
    }
  }
  if (![...ports].every(port => listeners.has(port)) || await processStart() !== start) throw new Error('Server listener or process start is not locally corroborated');
  return { pid: info.pid, start, boot, uid, tmp, urls: [...info.urls].sort(), version: info.version, ...(endpoint === undefined ? {} : { endpoint }) };
}

/** @param {string} id @param {unknown[]} errors @param {string} action */
function workerError(id, errors, action) {
  return new AggregateError(errors, `Worker ${id} ${action}; retained admission may require explicit reconciliation`, { cause: errors[0] });
}

/** Ledger-backed execution. SDK worker storage is only a best-effort projection. */
export class WorkerLifecycle {
  /** @param {any} ctx @param {string} root @param {string} directory @param {string} prefix
   * @param {(context:Context,action:string,resource:string)=>Promise<void>} permit */
  constructor(ctx, root, directory, prefix, permit) {
    this.ctx = ctx;
    this.root = root;
    this.directory = directory;
    this.prefix = prefix;
    this.permit = permit;
    const options = ctx.options?.admission ?? {};
    this.ledgerDirectory = options.directory ?? join(root, '.pstack-state/admission');
    this.admission = new Admission({ directory: this.ledgerDirectory, ...(options.limits ? { limits: options.limits } : {}) });
    /** @type {Map<string,{abort:AbortController,pending:Promise<any>}>} */
    this.starts = new Map();
    this.shutdown = new AbortController();
    this.closed = false;
  }

  /** @template T @param {()=>Promise<T>} operation */
  transaction(operation) {
    return serialized(this.ledgerDirectory, async () => {
      await canonicalDirectory(this.ledgerDirectory);
      return operation();
    });
  }

  /** @param {string} owner */
  scope(owner) { return { owner, project: this.directory }; }

  /** @param {Record} record */
  view(record) {
    return { id: record.id, owner: record.owner, project: record.project, sessionID: record.intentions.session,
      directory: record.intentions.worktree, control: record.intentions.location, ref: record.spec.ref,
      backend: record.backend, role: record.spec.role, task: record.spec.task, model: parseModelRef(record.spec.model),
      ...(record.plan?.server ? { server: record.plan.server } : {}),
      ...(record.plan?.container ? { engine: record.plan.container.engine, container: record.intentions.container,
        ...(record.observed?.containerID ? { containerID: record.observed.containerID } : {}) } : {}),
      state: record.state, resources: record.resources, observed: record.observed, ...(record.cleanup ? { cleanup: record.cleanup } : {}) };
  }

  /** @param {string} owner @param {string} id */
  async record(owner, id) {
    const record = await this.transaction(() => this.admission.get(id, this.scope(owner)));
    if (!record) throw new Error('Worker not owned by this session; legacy records require explicit reconciliation');
    return record;
  }

  /** @param {string} owner @param {string} id */
  async get(owner, id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid worker ID');
    let exists = true;
    try { await lstat(this.ledgerDirectory); }
    catch (error) { if (/** @type {any} */ (error).code === 'ENOENT') exists = false; else throw error; }
    const record = exists ? await this.transaction(() => this.admission.get(id, this.scope(owner))) : undefined;
    if (record) return this.view(record);
    const legacy = await this.ctx.storage.get(this.prefix + id);
    if (!legacy || legacy.id !== id || legacy.owner !== owner) throw new Error('Worker not owned by this session');
    return { ...legacy, state: 'uncertain', reconciliationRequired: true };
  }

  /** Merge one bounded projection page with ledger records, including missing projections.
   * Degraded continuations stay ledger-only and explicitly lack legacy coverage.
   * @param {string} owner @param {number} limit @param {string} [after] */
  async scan(owner, limit, after, ledgerOnly = false) {
    const records = await this.transaction(() => this.admission.list(this.scope(owner)));
    let page;
    if (!ledgerOnly) {
      try { page = await this.ctx.storage.scan({ prefix: this.prefix, limit, after }); }
      catch { ledgerOnly = true; }
    }
    if (ledgerOnly) {
      const entries = records.map(record => ({ key: this.prefix + record.id, value: this.view(record) }))
        .filter(entry => !after || entry.key > after).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      return { entries: entries.slice(0, limit), next: entries.length > limit ? entries[limit - 1].key : undefined,
        ledgerOnly: true, warnings: ['Projection storage unavailable; ledger-only discovery has incomplete legacy coverage'] };
    }
    /** @type {Map<string,any>} */
    const values = new Map(page.entries.map((/** @type {{key:string,value:any}} */ { key, value }) =>
      [key, { ...value, state: 'uncertain', reconciliationRequired: true }]));
    for (const record of records) {
      const key = this.prefix + record.id;
      if ((!after || key > after) && (!page.next || key <= page.next)) values.set(key, this.view(record));
    }
    const entries = [...values].map(([key, value]) => ({ key, value })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const selected = entries.slice(0, limit);
    return { entries: selected, next: entries.length > limit ? selected.at(-1)?.key : page.next };
  }

  async cursorKey() { return Buffer.from(await this.transaction(() => this.admission.cursorKey()), 'hex'); }

  /** Middleware-free history remains safe after stop and location eviction.
   * @param {string} owner @param {string} id @param {number} limit @param {string} [cursor] @param {AbortSignal} [signal] */
  async messages(owner, id, limit, cursor, signal = new AbortController().signal) {
    const record = await this.record(owner, id);
    const transport = await workerTransport(this.ctx.options?.server, signal);
    await this.serverIdentity(record, transport, signal);
    const page = await transport.client.message.list({ sessionID: /** @type {string} */ (record.intentions.session), limit, cursor }, { signal });
    await this.serverIdentity(record, transport, signal);
    return page;
  }

  /** A legacy projection must be accounted for before any new capacity is authorized. */
  async rolloutGate() {
    /** @type {string|undefined} */
    let after;
    do {
      /** @type {{entries:{key:string,value:any}[],next?:string}} */
      const page = await this.ctx.storage.scan({ prefix: '', limit: 100, after });
      for (const { key, value } of page.entries) {
        if (!/\/worker\/[a-f0-9-]+$/.test(key)) continue;
        const record = value?.project && await this.transaction(() => this.admission.get(value.id, { owner: value.owner, project: value.project }));
        if (!record) throw new Error('Legacy worker records require explicit reconciliation before worker start; no automatic cleanup');
      }
      if (page.next && page.next === after) throw new Error('Non-advancing worker storage scan');
      after = page.next;
    } while (after);
  }

  /** @param {string} owner @param {string} id @param {import('./admission.js').Transition} change */
  update(owner, id, change) { return this.transaction(() => this.admission.update(id, this.scope(owner), change)); }

  /** @param {Record} record */
  async project(record) {
    try { await this.ctx.storage.set(this.prefix + record.id, this.view({ ...record,
      ...(record.observed ? { observed: { ...record.observed, projection: 'saved' } } : {}) })); }
    catch (error) {
      const errors = [error];
      try { await this.update(record.owner, record.id, { type: 'observe', projection: 'failed', failure: receipt(error) }); }
      catch (bookkeeping) { errors.push(bookkeeping); }
      throw workerError(record.id, errors, 'projection failed');
    }
    try { return (await this.update(record.owner, record.id, { type: 'observe', projection: 'saved' })).record; }
    catch (error) { throw workerError(record.id, [error], 'projection observation failed'); }
  }

  /** @param {any} input @param {Context} context @param {any} parent */
  async start(input, context, parent) {
    if (this.closed) throw new Error('Worker admission closed');
    const abort = new AbortController();
    const signal = AbortSignal.any([context.signal, abort.signal, this.shutdown.signal]);
    const id = randomUUID();
    const pending = this.create(id, input, context, parent, signal);
    this.starts.set(id, { abort, pending });
    try { return await pending; }
    finally { this.starts.delete(id); }
  }

  /** @param {string} id @param {any} input @param {Context} context @param {any} parent @param {AbortSignal} signal */
  async create(id, input, context, parent, signal) {
    signal.throwIfAborted();
    if (!input.prompt || !input.ref) throw new Error('Worker start needs a prompt and an explicit committed ref');
    const role = input.role ?? 'poteto-agent';
    const { task, model } = resolveModel(await loadModelPolicy(this.root), role, input.task);
    assertModelAvailable(model, (await this.ctx.model.list({ location: { directory: this.directory } })).data);
    signal.throwIfAborted();
    await this.permit(context, 'pstack_worker', 'start');
    signal.throwIfAborted();
    await this.permit(context, 'subagent', role);
    signal.throwIfAborted();
    await this.rolloutGate();
    signal.throwIfAborted();
    const { stdout } = await exec('git', ['rev-parse', '--verify', '--end-of-options', `${input.ref}^{commit}`],
      { cwd: this.directory, signal, timeout: 30000, killSignal: 'SIGKILL' });
    const ref = stdout.trim();
    if (!/^[a-f0-9]{40,64}$/.test(ref)) throw new Error('Ref did not resolve to a commit');
    const backend = input.backend ?? 'container';
    const base = join(tmpdir(), 'opencode', `pstack-worker-${id}`);
    const checkout = join(base, 'checkout');
    const location = backend === 'container' ? join(base, 'control') : checkout;
    const denied = (parent.permissions ?? []).filter((/** @type {any} */ rule) => rule.effect !== 'allow');
    const permissions = backend === 'container' ? [
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'container_command', resource: '*', effect: 'allow' },
      { action: 'pstack_container_script', resource: '*', effect: 'ask' },
      { action: 'shell', resource: '*', effect: role === 'poteto-agent' ? 'allow' : 'ask' },
      ...['git commit *', 'git push *'].map(resource => ({ action: 'shell', resource, effect: 'deny' })), ...denied,
    ] : [...denied, ...['subagent', 'pstack_schedule', 'pstack_worker', 'pstack_worker_review',
      ...(role !== 'poteto-agent' ? ['edit', 'shell', 'pstack_terminal'] : [])].map(action => ({ action, resource: '*', effect: 'deny' }))];
    const engine = this.ctx.options?.container?.engine ?? 'docker';
    const image = this.ctx.options?.container?.image ?? 'opencode-pstack-worker:0.1.0';
    const transport = await workerTransport(this.ctx.options?.server, signal);
    const server = await originatingServer(transport, signal);
    signal.throwIfAborted();
    let record = await this.transaction(() => {
      signal.throwIfAborted();
      return this.admission.reserve({ id, ...this.scope(context.sessionID), backend,
        intentions: { location, worktree: checkout, session: SessionID.create(), ...(backend === 'container' ? { container: `pstack-${id}` } : {}) },
        spec: { role, task, model: `${model.providerID}/${model.id}#${model.variant}`, ref, promptID: SessionMessage.ID.create() },
        plan: { prompt: backend === 'container' ? input.prompt : `Bounded isolated worker. Do not commit, push, spawn workers, or broaden scope. Return evidence and changed paths.\n${input.prompt}`,
          permissions, server, ...(backend === 'container' ? { container: { engine, image } } : {}) } });
    });
    return serialized('worker:' + this.ledgerDirectory + ':' + id, async () => {
      /** @param {import('./admission.js').Resource} resource @param {()=>Promise<void>} operation */
      const acquire = async (resource, operation) => {
        signal.throwIfAborted();
        const acquired = await this.update(record.owner, id, { type: 'acquire', resource });
        if (!acquired.completionToken) throw new Error('Creation authorization already consumed');
        signal.throwIfAborted();
        await operation();
        record = (await this.update(record.owner, id, { type: 'complete', resource, completionToken: acquired.completionToken, outcome: 'present' })).record;
      };
      try {
        await acquire('worktree', async () => {
          await canonicalDirectory(join(tmpdir(), 'opencode'));
          await mkdir(base, { mode: 0o700 });
          if (backend === 'local') await exec('git', ['worktree', 'add', '--detach', checkout, ref], { cwd: this.directory, signal, timeout: 120000, killSignal: 'SIGKILL' });
          else {
            await exec('git', ['clone', '--no-hardlinks', '--no-checkout', '--', this.directory, checkout], { signal, timeout: 120000, killSignal: 'SIGKILL' });
            await exec('git', ['checkout', '--detach', ref], { cwd: checkout, signal, timeout: 120000, killSignal: 'SIGKILL' });
          }
        });
        await acquire('location', async () => {
          if (backend === 'local') await bootstrapLocalWorker(this.root, checkout, permissions);
          else await mkdir(location, { mode: 0o700 });
        });
        if (backend === 'container') {
          const options = await containerOptions(record.plan?.container, signal);
          await acquire('container', async () => {
            const running = await startContainer(options, this.view(record), signal);
            record = (await this.update(record.owner, id, { type: 'observe', containerID: running.containerID })).record;
          });
          await writeFile(join(location, 'opencode.json'), JSON.stringify({
            plugins: [{ package: join(this.root, 'internal/pstack-worker'), options: { worker: this.view(record) } }],
            agents: { 'pstack-container': { mode: 'primary',
              system: 'You are a bounded container worker. Use only container_command. Your files are at /workspace inside an offline container. Do not attempt host access, commit, push, or expand scope. Return evidence and changed paths. Review roles have a read-only workspace.', permissions } },
          }), { flag: 'wx', mode: 0o600 });
        }
        await acquire('session', async () => {
          await this.serverIdentity(record, transport, signal);
          const created = await transport.client.session.create({
            id: record.intentions.session, title: backend === 'container' ? `pstack container ${role}` : 'pstack isolated worker',
            agent: backend === 'container' ? 'pstack-container' : role, model, location: { directory: location }, permissions,
            metadata: { pstackWorker: id, pstackOwner: record.owner, pstackSource: this.directory, pstackRef: ref, pstackServer: server },
          }, { signal });
          this.sessionIdentity(record, created);
          await this.serverIdentity(record, transport, signal);
          signal.throwIfAborted();
          await transport.client.session.prompt({ sessionID: /** @type {string} */ (record.intentions.session), id: record.spec.promptID, text: /** @type {string} */ (record.plan?.prompt) }, { signal });
          await this.serverIdentity(record, transport, signal);
        });
        signal.throwIfAborted();
        record = (await this.update(record.owner, id, { type: 'activate' })).record;
        record = await this.project(record);
        return this.view(record);
      } catch (error) {
        const errors = [error];
        try {
          await this.update(record.owner, id, { type: 'uncertain' });
          await this.update(record.owner, id, { type: 'observe', failure: receipt(error) });
        } catch (persistenceError) { errors.push(persistenceError); }
        throw workerError(id, errors, 'failed');
      }
    });
  }

  /** @param {Record} record @param {any} session */
  sessionIdentity(record, session) {
    if (session?.id !== record.intentions.session || session.location?.directory !== record.intentions.location ||
        session.metadata?.pstackWorker !== record.id || session.metadata?.pstackOwner !== record.owner ||
         session.metadata?.pstackSource !== record.project || session.metadata?.pstackRef !== record.spec.ref ||
         JSON.stringify(session.metadata?.pstackServer) !== JSON.stringify(record.plan?.server)) throw new Error('Worker session identity or location mismatch');
  }

  /** @param {Record} record @param {Awaited<ReturnType<typeof workerTransport>>} transport @param {AbortSignal} signal */
  async serverIdentity(record, transport, signal) {
    if (!record.plan?.server?.endpoint || transport.endpoint !== record.plan.server.endpoint ||
        JSON.stringify(await originatingServer(transport, signal)) !== JSON.stringify(record.plan.server)) throw new Error('Originating worker server instance mismatch or unsupported identity; execution remains charged');
  }

  /** Every request is charged before dispatch. Failure is not proof of remote settlement.
   * @template T @param {Record} record @param {string} lease @param {string} operation
   * @param {()=>Promise<T>} perform @param {boolean} [evicted] */
  async request(record, lease, operation, perform, evicted = false) {
    const admitted = await this.update(record.owner, record.id, { type: 'request', completionToken: lease, operation });
    if (!admitted.completionToken) throw new Error('No worker request authorization');
    const result = await perform();
    await this.update(record.owner, record.id, { type: 'settle-request', completionToken: lease, requestToken: admitted.completionToken, ...(evicted ? { evicted: true } : {}) });
    return result;
  }

  /** @template T @param {Record} record @param {Awaited<ReturnType<typeof workerTransport>>} transport
   * @param {string} lease @param {AbortSignal} signal @param {string} operation @param {()=>Promise<T>} perform
   * @param {boolean} [evicted] @param {(result:any)=>void} [validate] */
  async workerAPI(record, transport, lease, signal, operation, perform, evicted = false, validate = () => {}) {
    // /api/info has no location middleware. Reject a changed server before worker access.
    await this.serverIdentity(record, transport, signal);
    return this.request(record, lease, operation, async () => {
      const result = await perform();
      validate(result);
      await this.serverIdentity(record, transport, signal);
      return result;
    }, evicted);
  }

  /** @param {string} owner @param {string} id @param {AbortSignal} signal */
  async status(owner, id, signal) {
    try { return await this.workerStatus(owner, id, signal); }
    catch (error) { throw workerError(id, [error], 'status failed'); }
  }

  /** @param {string} owner @param {string} id @param {AbortSignal} signal */
  async workerStatus(owner, id, signal) {
    const view = await this.get(owner, id);
    if ('reconciliationRequired' in view) return view;
    const record = await this.record(owner, id);
    if (record.state !== 'active') return this.view(record);
    return this.readAccess(record, signal, async lease => {
      const transport = await workerTransport(this.ctx.options?.server, signal);
      const sessionID = /** @type {string} */ (record.intentions.session);
      const session = await this.workerAPI(record, transport, lease, signal, 'get session', () => transport.client.session.get({ sessionID }, { signal }));
      this.sessionIdentity(record, session);
      return { ...this.view(record), session: { data: session },
        ...(record.backend === 'container' ? { result: await this.request(record, lease, 'inspect container', () => inspectContainer(this.view(record), false, signal)) } : {}),
        messages: await this.workerAPI(record, transport, lease, signal, 'get messages', () => transport.client.message.list({ sessionID, limit: 10, order: 'desc' }, { signal })) };
    });
  }

  /** @template T @param {Record} record @param {AbortSignal} signal @param {(lease:string)=>Promise<T>} operation */
  async readAccess(record, signal, operation) {
    /** @type {unknown[]} */
    const errors = [];
    let lease;
    let result;
    try {
      const access = await this.update(record.owner, record.id, { type: 'access', kind: 'read' });
      lease = access.completionToken;
      if (!lease) throw new Error('Worker access is unavailable after stop');
      result = await operation(lease);
    } catch (error) { errors.push(error); }
    if (lease) {
      try { await this.update(record.owner, record.id, { type: 'end-access', completionToken: lease }); }
      catch (error) { errors.push(error); }
      if (errors.length) {
        try { await this.update(record.owner, record.id, { type: 'uncertain' }); }
        catch (error) { errors.push(error); }
        try { await this.update(record.owner, record.id, { type: 'observe', failure: receipt(errors[0]) }); }
        catch (error) { errors.push(error); }
      }
    }
    if (errors.length) throw workerError(record.id, errors, 'read failed');
    return result;
  }

  /** @param {string} owner @param {string} id */
  async stop(owner, id) {
    try { return await this.stopWorker(owner, id); }
    catch (error) { throw workerError(id, [error], 'stop failed'); }
  }

  /** @param {string} owner @param {string} id */
  async stopWorker(owner, id) {
    const view = await this.get(owner, id);
    if ('reconciliationRequired' in view) return view;
    const initial = await this.record(owner, id);
    if (initial.state === 'stopped') return this.view(initial);
    this.starts.get(id)?.abort.abort(new Error('Worker stop requested'));
    return serialized('worker:' + this.ledgerDirectory + ':' + id, async () => {
      let record = await this.record(owner, id);
      if (record.state === 'stopped') return this.view(record);
      const access = await this.update(owner, id, { type: 'access', kind: 'stop' });
      const lease = access.completionToken;
      if (!lease) return this.view(access.record);
      record = access.record;
      const signal = AbortSignal.timeout(65000);
      /** @type {unknown[]} */
      const errors = [];
      let bookkeepingFailed = false;
      const disposed = record.cleanup?.evicted === true;
      let sessionStopped = disposed || record.resources.session?.attempt === null;
      let containerStopped = disposed || record.backend === 'local' || record.resources.container?.attempt === null;
      let locationStopped = disposed || record.resources.location?.attempt === null;
      const outstanding = Object.values(record.resources).some(resource => resource.attempt?.state === 'outstanding');
      /** @type {Awaited<ReturnType<typeof workerTransport>>|undefined} */
      let transport;
      const sessionID = /** @type {string} */ (record.intentions.session);
      const cleanupSession = async () => {
        if (sessionStopped) return;
        try {
          const pinned = await workerTransport(this.ctx.options?.server, signal);
          transport = pinned;
          const session = await this.workerAPI(record, pinned, lease, signal, 'get session', () => pinned.client.session.get({ sessionID }, { signal }));
          this.sessionIdentity(record, session);
          await this.workerAPI(record, pinned, lease, signal, 'cancel inbox', () => pinned.client.session.inbox.cancel({ sessionID, inboxID: record.spec.promptID }, { signal }));
          await this.workerAPI(record, pinned, lease, signal, 'interrupt session', () => pinned.client.session.interrupt({ sessionID, resume: false }, { signal }), false, result => {
            if (typeof result?.interrupted !== 'boolean') throw new Error('Worker interruption was not confirmed');
          });
          const inbox = await this.workerAPI(record, pinned, lease, signal, 'get inbox', () => pinned.client.session.inbox.list({ sessionID }, { signal }));
          if (!Array.isArray(inbox) || inbox.length) throw new Error('Worker inbox remains nonempty or unavailable');
          sessionStopped = true;
        } catch (error) { errors.push(error); }
      };
      const cleanupContainer = async () => {
        if (containerStopped || record.backend !== 'container') return;
        try {
          if (!record.observed?.containerID) {
            const observed = await this.request(record, lease, 'discover container', () => inspectContainer(this.view(record), false, signal));
            try { record = (await this.update(owner, id, { type: 'observe', containerID: observed.containerID })).record; }
            catch (error) { bookkeepingFailed = true; throw error; }
          }
          const result = await this.request(record, lease, 'stop container', () => inspectContainer(this.view(record), true, signal));
          if (result.running || result.paused || result.restarting) throw new Error('Worker container execution remains possible');
          containerStopped = true;
        } catch (error) { errors.push(error); }
      };
      await Promise.all([cleanupSession(), cleanupContainer()]);
      try { record = await this.record(owner, id); }
      catch (error) { errors.push(error); bookkeepingFailed = true; }
      if (!locationStopped && !outstanding && !record.cleanup?.requests.length && sessionStopped && containerStopped && !errors.length) {
        try {
          if (record.resources.session?.attempt !== null) {
            if (!transport) throw new Error('Pinned worker cleanup endpoint unavailable');
            const pinned = transport;
            const evictionSignal = AbortSignal.timeout(30000);
            const session = await this.workerAPI(record, pinned, lease, evictionSignal, 'get session', () => pinned.client.session.get({ sessionID }, { signal: evictionSignal }));
            this.sessionIdentity(record, session);
            if (record.intentions.location === record.project || await realpath(/** @type {string} */ (record.intentions.location)) !== record.intentions.location) throw new Error('Worker location is not owned and dedicated');
            await this.workerAPI(record, pinned, lease, evictionSignal, 'evict location', () => pinned.client.debug.location.evict({ location: { directory: record.intentions.location } }, { signal: evictionSignal }), true);
          }
          locationStopped = true;
        } catch (error) { errors.push(error); }
      }
      if (outstanding) errors.push(new Error('Creator or remote admission may still resume; outstanding authorization remains charged'));
      try { record = (await this.update(owner, id, { type: 'end-access', completionToken: lease })).record; }
      catch (error) { errors.push(error); bookkeepingFailed = true; }
      try {
        if (!outstanding && !record.cleanup?.requests.length && sessionStopped && containerStopped && locationStopped && !errors.length) {
          for (const [name, resource] of Object.entries(record.resources)) {
            record = (await this.update(owner, id, { type: 'verify', resource: /** @type {import('./admission.js').Resource} */ (name),
              state: resource.attempt === null ? 'absent' : ['location', 'worktree'].includes(name) ? 'retained' : 'released',
              evidence: resource.attempt === null ? 'Creation never authorized; executor drained' : 'Startup settled; inbox cancelled on bound server, session interrupted, owned container stopped and dedicated location evicted; files retained' })).record;
          }
          record = await this.transaction(() => this.admission.release(id, this.scope(owner)));
        } else record = (await this.update(owner, id, { type: 'uncertain' })).record;
      } catch (error) { errors.push(error); bookkeepingFailed = true; }
      const failures = [...errors];
      for (const error of failures) {
        try { record = (await this.update(owner, id, { type: 'observe', failure: receipt(error) })).record; }
        catch (bookkeeping) { errors.push(bookkeeping); }
      }
      try { record = await this.project(record); }
      catch (error) { errors.push(error); }
      if (bookkeepingFailed || errors.length > failures.length) throw workerError(id, errors, 'cleanup or bookkeeping failed');
      return { ...this.view(record), ...(errors.length ? { cleanupErrors: errors.map(receipt) } : {}) };
    });
  }

  async close() {
    this.closed = true;
    this.shutdown.abort(new Error('Worker runtime unloaded'));
    if (!this.starts.size) return;
    const drained = Promise.allSettled([...this.starts.values()].map(start => start.pending));
    let timer;
    try { await Promise.race([drained, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); }
    finally { clearTimeout(timer); }
  }
}
