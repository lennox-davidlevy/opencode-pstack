import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, normalize, parse } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** @typedef {'reserved'|'acquiring'|'active'|'stopping'|'stopped'|'uncertain'} Lifecycle */
/** @typedef {'location'|'worktree'|'session'|'container'} Resource */
/** @typedef {{state:'outstanding',tokenDigest:string}|{state:'settled'}|{state:'recovered',evidence:string}} CreationAttempt */
/** @typedef {{state:'absent'|'possible'|'present'|'released'|'retained',evidence:string|null,attempt:CreationAttempt|null}} ResourceState */
/** @typedef {{role:'poteto-agent'|'poteto-reviewer'|'poteto-investigator',task:'coordination'|'implementation'|'hard'|'investigation'|'review'|'mechanical',model:string,ref:string,promptID:string}} ExecutionSpec */
/** @typedef {{pid:number,start:string,boot:string,uid:number,tmp:string,urls:string[],version:string,endpoint?:string}} ServerIdentity */
/** @typedef {{prompt:string,permissions:{action:string,resource:string,effect:'allow'|'deny'|'ask'}[],container?:{engine:string,image:string},server?:ServerIdentity}} RuntimePlan */
/** @typedef {{producer:{tokenDigest:string,kind:'stop'|'read'}|null,requests:{tokenDigest:string,operation:string}[],evicted:boolean}} Cleanup */
/** @typedef {{containerID:string|null,failures:string[],projection:'pending'|'saved'|'failed'}} Observation */
/** @typedef {{id:string,owner:string,project:string,backend:'local'|'container',intentions:Partial<Record<Resource,string>>,spec:ExecutionSpec,plan?:RuntimePlan}} Identity */
/** @typedef {Identity & {state:Lifecycle,resources:Partial<Record<Resource,ResourceState>>,observed?:Observation,cleanup?:Cleanup}} AdmissionRecord */
/** @typedef {{owner:string,project:string}} Scope */
/** @typedef {{activeWorkers:number,retainedRecords:number}} Limits */
/** @typedef {{version:1,limits:Limits,records:AdmissionRecord[],cursorKey?:string}} Ledger */
/** @typedef {{type:'access',kind:'stop'|'read'}|{type:'end-access',completionToken:string}|{type:'request',completionToken:string,operation:string}|{type:'settle-request',completionToken:string,requestToken:string,evicted?:boolean}|{type:'acquire',resource:Resource}|{type:'complete',resource:Resource,completionToken:string,outcome:'present'|'unknown'}|{type:'recover-quiescent',resource:Resource,evidence:string}|{type:'activate'}|{type:'stop'}|{type:'uncertain'}|{type:'observe',containerID?:string,failure?:string,projection?:Observation['projection']}|{type:'verify',resource:Resource,state:'absent'|'released'|'retained',evidence:string}} Transition */
/** @typedef {import('node:fs/promises').FileHandle} FileHandle */
/** @typedef {import('node:fs').Stats} Stats */

const LEDGER = 'ledger.json';
const MARKER = 'initialized';
const LOCK = 'lock';
const NEXT = 'ledger.next';
const MARKER_TEXT = '{"version":1}\n';
const MAX_BYTES = 16 * 1024 * 1024;
const NOFOLLOW = constants.O_NOFOLLOW;
const READ = constants.O_RDONLY | NOFOLLOW | constants.O_NONBLOCK;
const CREATE = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
const resourceNames = /** @type {const} */ (['location', 'worktree', 'session', 'container']);
const lifecycles = ['reserved', 'acquiring', 'active', 'stopping', 'stopped', 'uncertain'];

export class AdmissionError extends Error {
  /** @param {string} code @param {string} message @param {unknown} [cause] */
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'AdmissionError';
    this.code = code;
  }
}

/** @param {unknown} value @param {readonly string[]} required @param {readonly string[]} [optional] */
function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      !required.every(key => Object.hasOwn(value, key)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))) {
    throw new AdmissionError('INVALID_INPUT', 'Unexpected admission fields');
  }
  const object = /** @type {Record<string,unknown>} */ (value);
  if (Object.values(Object.getOwnPropertyDescriptors(object)).some(d => !('value' in d) || !d.enumerable)) {
    throw new AdmissionError('INVALID_INPUT', 'Admission fields must be enumerable data properties');
  }
  return object;
}

/** @param {unknown} value @param {number} [max] @returns {string} */
function text(value, max = 4096) {
  if (typeof value !== 'string' || !value.length || value.length > max ||
      value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) {
    throw new AdmissionError('INVALID_INPUT', 'Expected bounded nonempty admission text');
  }
  return value;
}

/** @param {unknown} value */
function token(value) {
  const result = text(value, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(result)) throw new AdmissionError('INVALID_INPUT', 'Invalid admission identity');
  return result;
}

/** @param {unknown} value */
function absolute(value) {
  const path = text(value);
  if (!isAbsolute(path) || normalize(path) !== path || path === parse(path).root || path.endsWith('/')) {
    throw new AdmissionError('INVALID_INPUT', 'Expected an absolute normalized non-root path');
  }
  return path;
}

/** @param {unknown} value @returns {Limits} */
function limits(value) {
  const input = fields(value, ['activeWorkers', 'retainedRecords']);
  for (const [key, max] of /** @type {const} */ ([['activeWorkers', 1000], ['retainedRecords', 10000]])) {
    if (!Number.isSafeInteger(input[key]) || /** @type {number} */ (input[key]) < 1 || /** @type {number} */ (input[key]) > max) {
      throw new AdmissionError('INVALID_INPUT', `Invalid admission limit ${key}`);
    }
  }
  return /** @type {Limits} */ ({ ...input });
}

/** @param {unknown} value @returns {Identity} */
function identity(value) {
  const input = fields(value, ['id', 'owner', 'project', 'backend', 'intentions', 'spec'], ['plan']);
  if (input.backend !== 'local' && input.backend !== 'container') throw new AdmissionError('INVALID_INPUT', 'Invalid admission backend');
  const names = input.backend === 'local' ? ['location', 'worktree', 'session'] : resourceNames;
  const intentions = fields(input.intentions, names);
  for (const name of names) text(intentions[name]);
  absolute(intentions.location);
  absolute(intentions.worktree);
  if ((input.backend === 'container' && intentions.location === intentions.worktree) || !/^ses_[a-zA-Z0-9]+$/.test(text(intentions.session, 128))) {
    throw new AdmissionError('INVALID_INPUT', 'Expected a separate container control location and an actual planned session ID');
  }
  const spec = fields(input.spec, ['role', 'task', 'model', 'ref', 'promptID']);
  if (!['poteto-agent', 'poteto-reviewer', 'poteto-investigator'].includes(text(spec.role, 64)) ||
      !['coordination', 'implementation', 'hard', 'investigation', 'review', 'mechanical'].includes(text(spec.task, 32))) {
    throw new AdmissionError('INVALID_INPUT', 'Invalid admission execution role or task');
  }
  return { id: token(input.id), owner: token(input.owner), project: absolute(input.project),
    backend: input.backend, intentions: Object.fromEntries(names.map(name => [name, intentions[name]])),
    spec: { role: /** @type {ExecutionSpec['role']} */ (spec.role), task: /** @type {ExecutionSpec['task']} */ (spec.task),
      model: text(spec.model, 256), ref: text(spec.ref, 256), promptID: token(spec.promptID) },
    ...(input.plan === undefined ? {} : { plan: runtimePlan(input.plan, input.backend) }) };
}

/** Optional runtime plans bind exact execution inputs. Observations never grant creation authority.
 * @param {unknown} value @param {'local'|'container'} backend @returns {RuntimePlan} */
function runtimePlan(value, backend) {
  const input = fields(value, backend === 'container' ? ['prompt', 'permissions', 'container'] : ['prompt', 'permissions'], ['server']);
  if (typeof input.prompt !== 'string' || !input.prompt.length || input.prompt.length > 20000 || input.prompt.includes('\0') ||
      !Array.isArray(input.permissions) || input.permissions.length > 1000) throw new AdmissionError('INVALID_INPUT', 'Invalid runtime plan');
  const permissions = input.permissions.map(value => {
    const rule = fields(value, ['action', 'resource', 'effect']);
    if (!['allow', 'deny', 'ask'].includes(/** @type {string} */ (rule.effect))) throw new AdmissionError('INVALID_INPUT', 'Invalid runtime permission');
    return { action: text(rule.action), resource: text(rule.resource), effect: /** @type {'allow'|'deny'|'ask'} */ (rule.effect) };
  });
  const plan = { prompt: input.prompt, permissions, ...(input.server === undefined ? {} : { server: serverIdentity(input.server) }) };
  if (backend === 'local') return plan;
  const container = fields(input.container, ['engine', 'image']);
  if (!['docker', 'podman'].includes(/** @type {string} */ (container.engine))) throw new AdmissionError('INVALID_INPUT', 'Invalid runtime engine');
  return { ...plan, container: { engine: text(container.engine), image: text(container.image, 256) } };
}

/** @param {unknown} value @returns {ServerIdentity} */
function serverIdentity(value) {
  const input = fields(value, ['pid', 'start', 'boot', 'uid', 'tmp', 'urls', 'version'], ['endpoint']);
  if (!Number.isSafeInteger(input.pid) || /** @type {number} */ (input.pid) < 1 ||
      !Number.isSafeInteger(input.uid) || /** @type {number} */ (input.uid) < 0 ||
      !/^[1-9][0-9]*$/.test(text(input.start, 32)) || !/^[a-f0-9-]{36}$/.test(text(input.boot, 36)) ||
      !Array.isArray(input.urls) || !input.urls.length || input.urls.length > 32) throw new AdmissionError('INVALID_INPUT', 'Invalid originating server identity');
  if (input.endpoint !== undefined) {
    let url;
    try { url = new URL(text(input.endpoint, 4096)); } catch { throw new AdmissionError('INVALID_INPUT', 'Invalid server endpoint'); }
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
        url.origin !== input.endpoint) throw new AdmissionError('INVALID_INPUT', 'Invalid server endpoint');
  }
  return { pid: /** @type {number} */ (input.pid), start: /** @type {string} */ (input.start), boot: /** @type {string} */ (input.boot),
    uid: /** @type {number} */ (input.uid), tmp: absolute(input.tmp), urls: input.urls.map(url => text(url, 4096)), version: text(input.version, 256),
    ...(input.endpoint === undefined ? {} : { endpoint: /** @type {string} */ (input.endpoint) }) };
}

/** @param {unknown} value @returns {Cleanup} */
function cleanup(value) {
  const input = fields(value, ['producer', 'requests', 'evicted']);
  if (!Array.isArray(input.requests) || input.requests.length > 32 || typeof input.evicted !== 'boolean') throw new AdmissionError('INVALID_INPUT', 'Invalid cleanup accounting');
  const hash = (/** @type {unknown} */ value) => { const result = text(value, 64); if (!/^[a-f0-9]{64}$/.test(result)) throw new AdmissionError('INVALID_INPUT', 'Invalid cleanup token'); return result; };
  /** @type {Cleanup['producer']} */
  let producer = null;
  if (input.producer !== null) {
    const item = fields(input.producer, ['tokenDigest', 'kind']);
    if (item.kind !== 'stop' && item.kind !== 'read') throw new AdmissionError('INVALID_INPUT', 'Invalid cleanup producer');
    producer = { tokenDigest: hash(item.tokenDigest), kind: item.kind };
  }
  const requests = input.requests.map(value => { const item = fields(value, ['tokenDigest', 'operation']); return { tokenDigest: hash(item.tokenDigest), operation: text(item.operation, 1024) }; });
  if (new Set(requests.map(r => r.tokenDigest)).size !== requests.length || input.evicted && requests.length) throw new AdmissionError('INVALID_INPUT', 'Invalid cleanup requests');
  return { producer, requests, evicted: input.evicted };
}

/** @param {unknown} value @returns {Observation} */
function observation(value) {
  const input = fields(value, ['containerID', 'failures', 'projection']);
  if (input.containerID !== null && !/^[a-f0-9]{64}$/.test(text(input.containerID, 64)) ||
      !Array.isArray(input.failures) || input.failures.length > 32 || !['pending', 'saved', 'failed'].includes(/** @type {string} */ (input.projection))) {
    throw new AdmissionError('INVALID_INPUT', 'Invalid runtime observation');
  }
  return { containerID: /** @type {string|null} */ (input.containerID), failures: input.failures.map(value => text(value, 1024)),
    projection: /** @type {Observation['projection']} */ (input.projection) };
}

/** @param {unknown} value @returns {Scope} */
function scope(value) {
  const input = fields(value, ['owner', 'project']);
  return { owner: token(input.owner), project: absolute(input.project) };
}

/** @param {unknown} value @returns {Transition} */
function transition(value) {
  const input = fields(value, ['type'], ['resource', 'state', 'evidence', 'completionToken', 'outcome', 'containerID', 'failure', 'projection', 'kind', 'operation', 'requestToken', 'evicted']);
  if (input.type === 'access') {
    fields(input, ['type', 'kind']);
    if (input.kind !== 'stop' && input.kind !== 'read') throw new AdmissionError('INVALID_INPUT', 'Invalid access kind');
    return /** @type {Transition} */ ({ ...input });
  }
  if (input.type === 'end-access' || input.type === 'request' || input.type === 'settle-request') {
    fields(input, ['type', 'completionToken', ...(input.type === 'request' ? ['operation'] : input.type === 'settle-request' ? ['requestToken'] : [])], input.type === 'settle-request' ? ['evicted'] : []);
    text(input.completionToken, 128);
    if (input.type === 'request') text(input.operation, 1024);
    if (input.type === 'settle-request') {
      text(input.requestToken, 128);
      if (input.evicted !== undefined && typeof input.evicted !== 'boolean') throw new AdmissionError('INVALID_INPUT', 'Invalid eviction receipt');
    }
    return /** @type {Transition} */ ({ ...input });
  }
  if (input.type === 'observe') {
    fields(input, ['type'], ['containerID', 'failure', 'projection']);
    if (input.containerID !== undefined && !/^[a-f0-9]{64}$/.test(text(input.containerID, 64)) ||
        input.failure !== undefined && !text(input.failure, 1024) ||
        input.projection !== undefined && !['pending', 'saved', 'failed'].includes(/** @type {string} */ (input.projection))) {
      throw new AdmissionError('INVALID_INPUT', 'Invalid runtime observation');
    }
    return /** @type {Transition} */ ({ ...input });
  }
  if (input.type === 'acquire') {
    fields(input, ['type', 'resource']);
  } else if (input.type === 'complete') {
    fields(input, ['type', 'resource', 'completionToken', 'outcome']);
    text(input.completionToken, 128);
    if (input.outcome !== 'present' && input.outcome !== 'unknown') throw new AdmissionError('INVALID_INPUT', 'Invalid creation outcome');
  } else if (input.type === 'recover-quiescent') {
    fields(input, ['type', 'resource', 'evidence']);
    text(input.evidence, 1024);
  } else if (input.type === 'verify') {
    fields(input, ['type', 'resource', 'state', 'evidence']);
    if (!['absent', 'released', 'retained'].includes(/** @type {string} */ (input.state))) throw new AdmissionError('INVALID_INPUT', 'Invalid verification state');
    text(input.evidence, 1024);
  } else if (input.type === 'activate' || input.type === 'stop' || input.type === 'uncertain') {
    fields(input, ['type']);
    return /** @type {Transition} */ ({ ...input });
  } else throw new AdmissionError('INVALID_INPUT', 'Invalid admission transition');
  if (!resourceNames.includes(/** @type {Resource} */ (input.resource))) throw new AdmissionError('INVALID_INPUT', 'Invalid admission resource');
  return /** @type {Transition} */ ({ ...input });
}

/** @param {unknown} value @returns {AdmissionRecord} */
function record(value) {
  const input = fields(value, ['id', 'owner', 'project', 'backend', 'intentions', 'spec', 'state', 'resources'], ['plan', 'observed', 'cleanup']);
  const base = identity({ ...Object.fromEntries(['id', 'owner', 'project', 'backend', 'intentions', 'spec'].map(k => [k, input[k]])),
    ...(input.plan === undefined ? {} : { plan: input.plan }) });
  if ((input.plan === undefined) !== (input.observed === undefined)) throw new AdmissionError('INVALID_INPUT', 'Missing runtime observation');
  if (!lifecycles.includes(/** @type {string} */ (input.state))) throw new AdmissionError('INVALID_INPUT', 'Invalid admission lifecycle');
  const resources = fields(input.resources, Object.keys(base.intentions));
  for (const [name, value] of Object.entries(resources)) {
    const resource = fields(value, ['state', 'evidence', 'attempt']);
    if (!['absent', 'possible', 'present', 'released', 'retained'].includes(/** @type {string} */ (resource.state))) {
      throw new AdmissionError('INVALID_INPUT', 'Invalid resource state');
    }
    if (resource.attempt !== null) {
      const attempt = fields(resource.attempt, ['state'], ['tokenDigest', 'evidence']);
      if (attempt.state === 'outstanding') {
        fields(attempt, ['state', 'tokenDigest']);
        if (!/^[a-f0-9]{64}$/.test(text(attempt.tokenDigest, 64)) || resource.state !== 'possible') {
          throw new AdmissionError('INVALID_INPUT', 'Invalid outstanding creation attempt');
        }
      } else if (attempt.state === 'settled') fields(attempt, ['state']);
      else if (attempt.state === 'recovered') {
        fields(attempt, ['state', 'evidence']);
        text(attempt.evidence, 1024);
        if (!['stopping', 'uncertain', 'stopped'].includes(/** @type {string} */ (input.state))) {
          throw new AdmissionError('INVALID_INPUT', 'Invalid recovered creation lifecycle');
        }
      } else throw new AdmissionError('INVALID_INPUT', 'Invalid creation attempt');
    }
    if (resource.evidence !== null) text(resource.evidence, 1024);
    if ((resource.state === 'possible' || resource.state === 'present') && resource.evidence !== null ||
        (resource.state === 'released' || resource.state === 'retained') && resource.evidence === null ||
        resource.state !== 'absent' && resource.attempt === null ||
        resource.state === 'absent' && resource.evidence === null && resource.attempt !== null ||
        resource.state === 'retained' && !artifact(/** @type {Resource} */ (name)) ||
        resource.state === 'released' && artifact(/** @type {Resource} */ (name))) {
      throw new AdmissionError('INVALID_INPUT', 'Invalid resource evidence');
    }
  }
  const states = /** @type {ResourceState[]} */ (Object.values(resources));
  if (input.state === 'reserved' && states.some(r => r.state !== 'absent' || r.evidence !== null || r.attempt !== null) ||
      input.state === 'acquiring' && (!states.some(r => r.state === 'possible' || r.state === 'present') || states.some(r => r.state === 'released' || r.evidence !== null)) ||
      input.state === 'active' && states.some(r => r.state !== 'present') ||
      input.state === 'stopped' && states.some(r => !terminal(r))) {
    throw new AdmissionError('INVALID_INPUT', 'Inconsistent admission lifecycle');
  }
  const accounting = input.cleanup === undefined ? undefined : cleanup(input.cleanup);
  if (input.state === 'stopped' && accounting && (accounting.producer || accounting.requests.length)) throw new AdmissionError('INVALID_INPUT', 'Stopped worker has outstanding cleanup');
  if (accounting?.evicted && !['stopping', 'uncertain', 'stopped'].includes(/** @type {string} */ (input.state))) throw new AdmissionError('INVALID_INPUT', 'Evicted worker is not terminal or stopping');
  return { ...base, state: /** @type {Lifecycle} */ (input.state), resources: /** @type {AdmissionRecord['resources']} */ (resources),
    ...(input.observed === undefined ? {} : { observed: observation(input.observed) }), ...(accounting ? { cleanup: accounting } : {}) };
}

/** @param {ResourceState} resource */
function terminal(resource) {
  return resource.attempt?.state !== 'outstanding' &&
    (resource.state === 'absent' || resource.state === 'released' || resource.state === 'retained') && resource.evidence !== null;
}

/** @param {Resource} resource */
function artifact(resource) { return resource === 'location' || resource === 'worktree'; }

/** @param {string} value */
function digest(value) { return createHash('sha256').update(value).digest('hex'); }

/** @param {AdmissionRecord} item @param {Scope} expected */
function checkScope(item, expected) {
  if (item.owner !== expected.owner || item.project !== expected.project) throw new AdmissionError('SCOPE_MISMATCH', 'Admission scope does not match');
}

/** @param {Stats} a @param {Stats} b */
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }

/** @param {unknown} error @param {string} code */
function hasCode(error, code) { return !!error && typeof error === 'object' && 'code' in error && error.code === code; }

/** @param {string} path @param {number} max @returns {Promise<string>} */
async function readSafe(path, max) {
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1 || before.size > max) throw new AdmissionError('UNSAFE_FILESYSTEM', 'Unsafe admission file');
  const file = await open(path, READ);
  try {
    const opened = await file.stat();
    if (!sameFile(before, opened) || opened.nlink !== 1) throw new AdmissionError('UNSAFE_FILESYSTEM', 'Admission file changed during open');
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await file.read(buffer, size, buffer.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    const after = await file.stat();
    const named = await lstat(path);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || !sameFile(after, named) || after.nlink !== 1 || named.nlink !== 1 || !named.isFile()) {
      throw new AdmissionError('UNSAFE_FILESYSTEM', 'Admission file changed during read');
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)); }
    catch (error) { throw new AdmissionError('CORRUPT_LEDGER', 'Invalid admission UTF-8', error); }
  } finally { await file.close(); }
}

/**
 * A dedicated, pre-existing canonical directory is required. All participants must
 * supply identical limits. Lock contention fails with LOCKED, without waiting or
 * stealing. Every non-stopped record consumes one slot, including reservations.
 * Reservations bind the full immutable plan but grant no execution authority.
 * Callers must use immutable ref and promptID targets. This ledger binds their
 * strings, not external Git or prompt contents, and does not check model policy.
 * Only acquire returning a non-null completionToken permits one creation attempt
 * for that exact resource intention and spec. No replay reissues the token.
 * The token digest persists as outstanding until complete or recover-quiescent.
 * Stop and restart never clear it. No timeout, absence check or lock age does so.
 *
 * Creation attempts account for external creators. Access grants one durable
 * exclusive read/cleanup producer. Each request must be charged before dispatch
 * and settled only after its remote work cannot resume. Ending the producer
 * never clears requests. Failed requests and crashed producers have no takeover.
 * After stop, drain all admitted attempts before verification.
 * Complete only after the external operation and any deferred remote creation
 * have settled and cannot later resume. A timeout alone is not settlement.
 * Late completion during stopping records the resource for cleanup, not release.
 *
 * Crash recovery requires externally established creator quiescence, including
 * every process and remote request that could still create or execute resources.
 * Only then may recover-quiescent retire an outstanding token with an evidence
 * receipt. It does not establish resource absence or authorize another attempt.
 * Never steal a token or lock from a creator that might resume. Ambiguous durable
 * writes retain a lock for manual inspection, not automatic recovery.
 * Verification and recovery evidence are caller attestations, not external checks.
 * Optional plan binds exact prompt, permissions and container engine/image inputs.
 * Its bounded observations record a write-once container ID, failure receipts and
 * projection outcomes. Observations grant no acquisition or release authority.
 * Retained means execution is terminal and cannot resume, while artifact files
 * intentionally remain. Location evidence must cover its executor and queued work.
 * Released means session/container execution is terminal, not artifact deletion.
 * No operation deletes resources or removes retained records.
 * Writers must cooperate and never remove live locks. The filesystem must support
 * exclusive create, atomic rename and directory fsync. Hostile writers are not isolated.
 */
export class Admission {
  #directory;
  #limits;
  /** @type {Stats|undefined} */
  #directoryIdentity;

  /** @param {{directory:string,limits?:Partial<Limits>}} options */
  constructor(options) {
    const input = fields(options, ['directory'], ['limits']);
    this.#directory = absolute(input.directory);
    const supplied = input.limits === undefined ? {} : fields(input.limits, [], ['activeWorkers', 'retainedRecords']);
    this.#limits = limits({ activeWorkers: 2, retainedRecords: 100, ...supplied });
  }

  /** Replays return the current record, never a new acquisition authorization.
   * @param {Identity} input @returns {Promise<AdmissionRecord>} */
  async reserve(input) {
    const request = identity(input);
    return this.#transaction(ledger => {
      const existing = ledger.records.find(r => r.id === request.id);
      if (existing) {
        checkScope(existing, request);
        if (existing.backend !== request.backend || resourceNames.some(k => existing.intentions[k] !== request.intentions[k]) ||
            JSON.stringify(existing.spec) !== JSON.stringify(request.spec) || JSON.stringify(existing.plan) !== JSON.stringify(request.plan)) {
          throw new AdmissionError('IDENTITY_MISMATCH', 'Admission identity is immutable');
        }
        return { result: existing, changed: false };
      }
      if (ledger.records.length >= ledger.limits.retainedRecords) throw new AdmissionError('RETENTION', 'Admission record limit reached');
      if (ledger.records.filter(r => r.state !== 'stopped').length >= ledger.limits.activeWorkers) throw new AdmissionError('CAPACITY', 'Admission worker capacity reached');
      const item = { ...request, state: /** @type {const} */ ('reserved'), resources: Object.fromEntries(
        Object.keys(request.intentions).map(k => [k, { state: 'absent', evidence: null, attempt: null }])),
        ...(request.plan ? { observed: { containerID: null, failures: [], projection: /** @type {const} */ ('pending') } } : {}) };
      ledger.records.push(item);
      return { result: item, changed: true };
    });
  }

  /** acquire persists an outstanding attempt before returning its one-shot token.
   * complete consumes it after creation settles, even during stopping. unknown
   * preserves possible presence. Neither outcome verifies terminal execution.
   * recover-quiescent needs external proof no creator or deferred work can resume.
   * verify is blocked while any attempt is outstanding. It attests absent resources,
   * released session/container execution, or retained but quiescent artifact files.
   * @param {string} id @param {Scope} expected @param {Transition} change
   * @returns {Promise<{record:AdmissionRecord,changed:boolean,completionToken:string|null}>} */
  async update(id, expected, change) {
    id = token(id);
    expected = scope(expected);
    const command = transition(change);
    return this.#transaction(ledger => {
      const item = this.#find(ledger, id, expected);
      const before = JSON.stringify(item);
      /** @type {string|null} */
      let completionToken = null;
      const invalid = () => { throw new AdmissionError('INVALID_TRANSITION', 'Admission transition is not allowed'); };
      if (command.type === 'access') {
        if (item.state === 'stopped') return { result: { record: item, changed: false, completionToken }, changed: false };
        const accounting = item.cleanup ??= { producer: null, requests: [], evicted: false };
        if (accounting.producer || accounting.requests.length) throw new AdmissionError('CLEANUP_OUTSTANDING', 'Worker access producer or remote cleanup may still resume; no stale takeover');
        if (command.kind === 'read' && (item.state !== 'active' || accounting.evicted)) invalid();
        completionToken = randomUUID();
        accounting.producer = { tokenDigest: digest(completionToken), kind: command.kind };
        if (command.kind === 'stop') item.state = 'stopping';
      } else if (command.type === 'end-access' || command.type === 'request' || command.type === 'settle-request') {
        const accounting = item.cleanup;
        if (!accounting?.producer || accounting.producer.tokenDigest !== digest(command.completionToken)) throw new AdmissionError('INVALID_COMPLETION', 'Worker access token is invalid');
        if (command.type === 'end-access') {
          accounting.producer = null;
          if (accounting.requests.length) item.state = 'uncertain';
        }
        else if (command.type === 'request') {
          if (accounting.evicted || accounting.requests.length >= 32) invalid();
          completionToken = randomUUID();
          accounting.requests.push({ tokenDigest: digest(completionToken), operation: command.operation });
        } else {
          const index = accounting.requests.findIndex(r => r.tokenDigest === digest(command.requestToken));
          if (index < 0 || command.evicted && (accounting.requests.length !== 1 || accounting.producer.kind !== 'stop')) invalid();
          accounting.requests.splice(index, 1);
          if (command.evicted) accounting.evicted = true;
        }
      } else if (command.type === 'observe') {
        if (!item.observed) invalid();
        const observed = /** @type {Observation} */ (item.observed);
        if (command.containerID !== undefined) {
          if (item.backend !== 'container' || observed.containerID && observed.containerID !== command.containerID) invalid();
          observed.containerID = command.containerID;
        }
        if (command.failure !== undefined && !observed.failures.includes(command.failure)) {
          if (observed.failures.length >= 32) throw new AdmissionError('RETENTION', 'Runtime failure receipt limit reached');
          observed.failures.push(command.failure);
        }
        if (command.projection !== undefined) observed.projection = command.projection;
      } else if (command.type === 'stop') {
        if (item.state !== 'stopped') item.state = 'stopping';
      } else if (command.type === 'uncertain') {
        if (item.state === 'stopped') invalid();
        item.state = 'uncertain';
      } else if (command.type === 'activate') {
        if (!['acquiring', 'active'].includes(item.state) || Object.values(item.resources).some(r => r.state !== 'present')) invalid();
        item.state = 'active';
      } else {
        const resource = item.resources[command.resource];
        if (!resource) throw new AdmissionError('INVALID_TRANSITION', 'Resource was not intended');
        if (command.type === 'acquire') {
          if (!['reserved', 'acquiring'].includes(item.state) || resource.evidence !== null) invalid();
          if (resource.state === 'absent') {
            completionToken = randomUUID();
            resource.state = 'possible';
            resource.attempt = { state: 'outstanding', tokenDigest: digest(completionToken) };
          }
          item.state = 'acquiring';
        } else if (command.type === 'complete') {
          if (!['acquiring', 'stopping', 'uncertain'].includes(item.state) || resource.attempt?.state !== 'outstanding' ||
              resource.attempt.tokenDigest !== digest(command.completionToken)) {
            throw new AdmissionError('INVALID_COMPLETION', 'Creation completion token is invalid or already consumed');
          }
          resource.attempt = { state: 'settled' };
          if (command.outcome === 'present') resource.state = 'present';
          else if (item.state !== 'stopping') item.state = 'uncertain';
        } else if (command.type === 'recover-quiescent') {
          if (!['stopping', 'uncertain'].includes(item.state) ||
              resource.attempt?.state !== 'outstanding' &&
              !(resource.attempt?.state === 'recovered' && resource.attempt.evidence === command.evidence)) invalid();
          resource.attempt = { state: 'recovered', evidence: command.evidence };
        } else {
          if (item.cleanup?.producer || item.cleanup?.requests.length) throw new AdmissionError('CLEANUP_OUTSTANDING', 'Worker access or remote cleanup may still resume');
          if (Object.values(item.resources).some(r => r.attempt?.state === 'outstanding')) {
            throw new AdmissionError('CREATOR_OUTSTANDING', 'Creation may still resume; settle it or establish creator quiescence externally');
          }
          if (!['stopping', 'uncertain'].includes(item.state) ||
              command.state === 'absent' && !['absent', 'possible'].includes(resource.state) ||
              command.state === 'released' && (artifact(command.resource) || !['possible', 'present', 'released'].includes(resource.state)) ||
              command.state === 'retained' && (!artifact(command.resource) || !['possible', 'present', 'retained'].includes(resource.state))) invalid();
          resource.state = command.state;
          resource.evidence = command.evidence;
        }
      }
      const changed = JSON.stringify(item) !== before;
      return { result: { record: item, changed, completionToken }, changed };
    });
  }

  /** Only explicit verified terminal resource states release capacity. The record stays.
   * @param {string} id @param {Scope} expected */
  async release(id, expected) {
    id = token(id);
    expected = scope(expected);
    return this.#transaction(ledger => {
      const item = this.#find(ledger, id, expected);
      if (item.state === 'stopped') return { result: item, changed: false };
      if (item.state !== 'stopping' || item.cleanup?.producer || item.cleanup?.requests.length || Object.values(item.resources).some(r => !terminal(r))) {
        throw new AdmissionError('INVALID_TRANSITION', 'Stop and verify every resource before releasing capacity');
      }
      item.state = 'stopped';
      return { result: item, changed: true };
    });
  }

  /** @param {string} id @param {Scope} expected @returns {Promise<AdmissionRecord|undefined>} */
  async get(id, expected) {
    id = token(id);
    expected = scope(expected);
    return this.#transaction(ledger => {
      const item = ledger.records.find(r => r.id === id);
      if (item) checkScope(item, expected);
      return { result: item, changed: false };
    });
  }

  /** @param {Scope} expected @returns {Promise<AdmissionRecord[]>} */
  async list(expected) {
    expected = scope(expected);
    return this.#transaction(ledger => ({ result: ledger.records.filter(r => r.owner === expected.owner && r.project === expected.project), changed: false }));
  }

  /** Cursor confidentiality must not depend on the nonauthoritative projection. */
  async cursorKey() {
    return this.#transaction(ledger => {
      const changed = ledger.cursorKey === undefined;
      ledger.cursorKey ??= randomBytes(32).toString('hex');
      return { result: ledger.cursorKey, changed };
    });
  }

  /** @param {Ledger} ledger @param {string} id @param {Scope} expected */
  #find(ledger, id, expected) {
    const item = ledger.records.find(r => r.id === id);
    if (!item) throw new AdmissionError('NOT_FOUND', 'Admission record not found');
    checkScope(item, expected);
    return item;
  }

  /** @param {FileHandle} directory */
  async #checkDirectory(directory) {
    let current = parse(this.#directory).root;
    for (const part of this.#directory.slice(current.length).split('/')) {
      current = join(current, part);
      if (!(await lstat(current)).isDirectory()) throw new AdmissionError('UNSAFE_FILESYSTEM', 'Admission directory has an unsafe ancestor');
    }
    const named = await lstat(this.#directory);
    const opened = await directory.stat();
    if (await realpath(this.#directory) !== this.#directory || !sameFile(named, opened) ||
        this.#directoryIdentity && !sameFile(this.#directoryIdentity, opened)) {
      throw new AdmissionError('UNSAFE_FILESYSTEM', 'Admission directory is not canonical or changed');
    }
    this.#directoryIdentity = opened;
  }

  /** @returns {Promise<Ledger|undefined>} */
  async #load() {
    const entries = await readdir(this.#directory);
    if (entries.some(name => ![LEDGER, MARKER, LOCK].includes(name))) throw new AdmissionError('UNSAFE_FILESYSTEM', 'Unrecognized admission directory contents require inspection');
    if (!entries.includes(MARKER) && !entries.includes(LEDGER)) return undefined;
    if (!entries.includes(MARKER) || !entries.includes(LEDGER)) throw new AdmissionError('CORRUPT_LEDGER', 'Incomplete admission ledger');
    if (await readSafe(join(this.#directory, MARKER), 64) !== MARKER_TEXT) throw new AdmissionError('CORRUPT_LEDGER', 'Invalid admission initialization marker');
    const raw = await readSafe(join(this.#directory, LEDGER), MAX_BYTES);
    try {
      const input = fields(JSON.parse(raw), ['version', 'limits', 'records'], ['cursorKey']);
      const storedLimits = limits(input.limits);
      if (input.version !== 1 || !Array.isArray(input.records)) throw new Error('Invalid ledger schema');
      const records = input.records.map(record);
      if (records.length > storedLimits.retainedRecords || new Set(records.map(r => r.id)).size !== records.length ||
          records.filter(r => r.state !== 'stopped').length > storedLimits.activeWorkers) throw new Error('Invalid ledger capacity');
      if (input.cursorKey !== undefined && !/^[a-f0-9]{64}$/.test(text(input.cursorKey, 64))) throw new Error('Invalid ledger cursor key');
      const ledger = { version: /** @type {const} */ (1), limits: storedLimits, records,
        ...(input.cursorKey === undefined ? {} : { cursorKey: /** @type {string} */ (input.cursorKey) }) };
      if (JSON.stringify(ledger, null, 2) + '\n' !== raw) throw new Error('Noncanonical ledger encoding');
      if (storedLimits.activeWorkers !== this.#limits.activeWorkers || storedLimits.retainedRecords !== this.#limits.retainedRecords) {
        throw new AdmissionError('LIMIT_MISMATCH', 'All admission participants must use the persisted limits');
      }
      return ledger;
    } catch (error) {
      if (error instanceof AdmissionError && error.code === 'LIMIT_MISMATCH') throw error;
      throw new AdmissionError('CORRUPT_LEDGER', 'Invalid admission ledger; manual inspection required', error);
    }
  }

  /** @param {FileHandle} directory @param {string} data @param {boolean} fresh */
  async #persist(directory, data, fresh) {
    if (fresh) {
      const marker = await open(join(this.#directory, MARKER), CREATE, 0o600);
      try { await marker.writeFile(MARKER_TEXT); await marker.sync(); }
      finally { await marker.close(); }
      await directory.sync();
    }
    const next = await open(join(this.#directory, NEXT), CREATE, 0o600);
    try { await next.writeFile(data); await next.sync(); }
    finally { await next.close(); }
    await this.#checkDirectory(directory);
    await rename(join(this.#directory, NEXT), join(this.#directory, LEDGER));
    await directory.sync();
  }

  /** @template T @param {(ledger:Ledger)=>{result:T,changed:boolean}} operation @returns {Promise<T>} */
  async #transaction(operation) {
    const directory = await open(this.#directory, READ | constants.O_DIRECTORY);
    /** @type {FileHandle|undefined} */
    let lock;
    let retain = false;
    try {
      await this.#checkDirectory(directory);
      try { lock = await open(join(this.#directory, LOCK), CREATE, 0o600); }
      catch (error) {
        if (hasCode(error, 'EEXIST')) throw new AdmissionError('LOCKED', 'Admission lock exists; inspect before any manual recovery');
        throw error;
      }
      // A failed durable write can have taken effect. Keep its lock for inspection.
      retain = true;
      await lock.writeFile(JSON.stringify({ version: 1, token: randomUUID() }) + '\n');
      await lock.sync();
      await directory.sync();
      retain = false;
      await this.#checkDirectory(directory);
      const loaded = await this.#load();
      const ledger = loaded ?? { version: 1, limits: { ...this.#limits }, records: [] };
      const outcome = operation(ledger);
      if (!loaded || outcome.changed) {
        const data = JSON.stringify(ledger, null, 2) + '\n';
        if (Buffer.byteLength(data) > MAX_BYTES) throw new AdmissionError('RETENTION', 'Admission ledger byte limit reached');
        retain = true;
        await this.#checkDirectory(directory);
        await this.#persist(directory, data, !loaded);
        retain = false;
      }
      return structuredClone(outcome.result);
    } catch (error) {
      if (retain) throw new AdmissionError('PERSISTENCE', 'Admission persistence is uncertain; lock retained and no authorization returned', error);
      throw error;
    } finally {
      try {
        if (lock && !retain) {
          await this.#checkDirectory(directory);
          const named = await lstat(join(this.#directory, LOCK));
          const owned = await lock.stat();
          if (!named.isFile() || named.nlink !== 1 || owned.nlink !== 1 || !sameFile(named, owned)) {
            throw new AdmissionError('UNSAFE_FILESYSTEM', 'Admission lock changed; not removing it');
          }
          await unlink(join(this.#directory, LOCK));
          await directory.sync();
        }
      } finally {
        try { await lock?.close(); }
        finally { await directory.close(); }
      }
    }
  }
}
