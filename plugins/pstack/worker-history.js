import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { api } from './api.js';

const workerID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** @typedef {Pick<import('@opencode/plugin/promise/storage').StorageDomain, 'get' | 'set' | 'scan'>} WorkerStorage */
/** @type {WeakMap<WorkerStorage, Map<string, Promise<Buffer>>>} */
const cursorKeys = new WeakMap();

/** @param {WorkerStorage} storage @param {string} prefix */
function cursorKey(storage, prefix) {
  let keys = cursorKeys.get(storage);
  if (!keys) {
    keys = new Map();
    cursorKeys.set(storage, keys);
  }
  let pending = keys.get(prefix);
  if (!pending) {
    pending = (async () => {
      // Keep key material outside the worker record scan namespace.
      const name = 'worker-cursor-key/' + prefix;
      let key = await storage.get(name);
      if (key === undefined) {
        key = randomBytes(32).toString('hex');
        await storage.set(name, key);
      }
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid worker cursor key');
      return Buffer.from(key, 'hex');
    })();
    keys.set(prefix, pending);
    pending.catch(() => keys.delete(prefix));
  }
  return pending;
}

/** @param {number} limit */
function pageLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be an integer from 1 to 100');
}

/** Durable worker discovery and history, restricted to one directory prefix and owner. */
export class WorkerHistory {
  /** @param {WorkerStorage} storage @param {string} prefix */
  constructor(storage, prefix) {
    this.storage = storage;
    this.prefix = prefix;
  }

  /** @param {string} owner @param {string} id @returns {Promise<any>} */
  async get(owner, id) {
    if (typeof id !== 'string' || !workerID.test(id)) throw new Error('Invalid worker ID');
    const worker = /** @type {any} */ (await this.storage.get(this.prefix + id));
    if (!worker || worker.id !== id || worker.owner !== owner) throw new Error('Worker not owned by this session');
    return worker;
  }

  /** Each call scans at most limit records. An owner-filtered page can be empty with a next cursor.
   * @param {string} owner @param {number} [limit] @param {string} [cursor]
   */
  async list(owner, limit = 20, cursor) {
    pageLimit(limit);
    const scope = Buffer.from(JSON.stringify([this.prefix, owner]));
    let after;
    if (cursor !== undefined) {
      try {
        if (typeof cursor !== 'string' || !cursor.length || cursor.length > 16000) throw new Error();
        const decoded = Buffer.from(cursor, 'base64url');
        if (decoded.length <= 28 || decoded.toString('base64url') !== cursor) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', await cursorKey(this.storage, this.prefix), decoded.subarray(0, 12));
        decipher.setAAD(scope);
        decipher.setAuthTag(decoded.subarray(12, 28));
        after = Buffer.concat([decipher.update(decoded.subarray(28)), decipher.final()]).toString('utf8');
        if (!after.startsWith(this.prefix)) throw new Error();
      } catch {
        throw new Error('Invalid worker cursor for this directory and owner');
      }
    }
    const page = await this.storage.scan({ prefix: this.prefix, limit, after });
    const workers = page.entries.flatMap(({ key, value }) => {
      const worker = /** @type {any} */ (value);
      return worker && typeof worker.id === 'string' && workerID.test(worker.id)
        && key === this.prefix + worker.id && worker.owner === owner ? [worker] : [];
    });
    let next;
    if (page.next) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', await cursorKey(this.storage, this.prefix), nonce);
      cipher.setAAD(scope);
      const encrypted = Buffer.concat([cipher.update(page.next, 'utf8'), cipher.final()]);
      next = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
    }
    return { workers, next };
  }

  /** @param {string} owner @param {string} id @param {number} [limit] @param {string} [cursor]
   * @param {AbortSignal} [signal] @param {typeof api} [request]
   */
  async messages(owner, id, limit = 20, cursor, signal, request = api) {
    pageLimit(limit);
    const worker = await this.get(owner, id);
    if (typeof worker.sessionID !== 'string' || !/^ses_[a-zA-Z0-9]+$/.test(worker.sessionID)) throw new Error('Invalid worker session ID');
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || !cursor.length || cursor.length > 16000) throw new Error('Invalid message cursor');
      query.set('cursor', cursor);
    }
    return request('get', `/api/session/${worker.sessionID}/message?${query}`, undefined, signal);
  }
}
