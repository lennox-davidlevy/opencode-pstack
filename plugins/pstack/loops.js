import { createHash } from 'node:crypto';

/** @typedef {{id:string, sessionID:string, directory:string, prompt:string,
 * intervalMs:number, remaining:number, nextAt:number, expiresAt:number,
 * state:'armed'|'dispatching'|'paused'|'done'|'cancelled', error?:string, receipt?:string, receiptSlot?:number}} Job
 */

export const MAX_RETAINED_SCHEDULES = 100;
export const MAX_ARMED_SCHEDULES = 20;
export const MAX_SCHEDULE_RECORD_BYTES = 64 * 1024;
const LIFECYCLE_RESERVE_BYTES = 4 * 1024;
export const SCHEDULE_SCAN_PAGE_SIZE = 100;
export const MAX_SCHEDULE_SCAN_PAGES = MAX_RETAINED_SCHEDULES + 1;

const stringFields = new Set(['id', 'sessionID', 'directory', 'prompt', 'state', 'error', 'receipt']);
const numberFields = new Set(['intervalMs', 'remaining', 'nextAt', 'expiresAt']);
const states = new Set(['armed', 'dispatching', 'paused', 'done', 'cancelled']);
const retentionRecovery = 'Operator-approved retention management is required; automatic pruning is not implemented. No records were deleted.';

class ScheduleStateError extends Error {}

/** @param {any} job @returns {number} */
function validateRecord(job) {
  const invalid = () => new ScheduleStateError(`Invalid or oversized schedule record; maximum ${MAX_SCHEDULE_RECORD_BYTES} JSON bytes; intervalMs must be a positive safe integer, remaining 0..100, timestamps nonnegative safe integers`);
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw invalid();
  let bytes = 2;
  let count = 0;
  for (const key in job) {
    if (!Object.hasOwn(job, key)) throw invalid();
    const value = job[key];
    if (stringFields.has(key)) {
      if (typeof value !== 'string' || value.length > MAX_SCHEDULE_RECORD_BYTES) throw invalid();
    } else if (numberFields.has(key) || key === 'receiptSlot') {
      if (!Number.isSafeInteger(value) || value < (key === 'intervalMs' ? 1 : 0)
        || (key === 'remaining' && value > 100)
        || (key === 'receiptSlot' && (value < 1 || value > 100))) throw invalid();
    } else throw invalid();
    bytes += Buffer.byteLength(JSON.stringify(key)) + 1 + Buffer.byteLength(JSON.stringify(value)) + (count++ ? 1 : 0);
    if (bytes > MAX_SCHEDULE_RECORD_BYTES) throw invalid();
  }
  for (const key of ['id', 'sessionID', 'directory', 'prompt', 'state']) {
    if (typeof job[key] !== 'string') throw invalid();
  }
  for (const key of numberFields) if (typeof job[key] !== 'number') throw invalid();
  if (job.receiptSlot !== undefined && typeof job.receipt !== 'string') throw invalid();
  if (!states.has(job.state)) throw invalid();
  return bytes;
}

/** @param {Job} job @param {number} slot */
function validateOutcome(job, slot) {
  validateRecord(job);
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > 100
    || !(job.state === 'paused'
      ? job.remaining === slot && typeof job.error === 'string'
        && (job.receiptSlot === undefined || job.receiptSlot > slot)
      : job.remaining === slot - 1 && job.state === (job.remaining ? 'armed' : 'done') && typeof job.receipt === 'string'
        && (job.receiptSlot === undefined || job.receiptSlot === slot))) {
    throw new ScheduleStateError('Invalid schedule outcome dispatch slot or transition');
  }
}

/** Durable bounded schedule. An uncertain dispatch is never retried automatically. */
export class Loops {
  /** @param {{get:(key:string)=>Promise<any>,set:(key:string,value:any)=>Promise<void>,scan:(input:any)=>Promise<any>}} storage
   * @param {string} prefix @param {(job:Job)=>Promise<string>} deliver
   */
  constructor(storage, prefix, deliver) {
    this.storage = storage;
    this.prefix = prefix;
    this.controlPrefix = 'pstack-schedule-controls/' + createHash('sha256').update(prefix).digest('hex') + '/';
    this.deliver = deliver;
    this.retired = false;
    this.tail = Promise.resolve();
    /** @type {Promise<void> | undefined} */
    this.ticking = undefined;
    /** @type {Error | undefined} */
    this.unavailable = undefined;
  }

  /** @param {unknown} error */
  quarantine(error) {
    this.unavailable ??= new Error(`Scheduler unavailable (quarantined): ${String(error)}. Automatic maintenance and new schedules are disabled. Ownership-checked cancellation by ID remains available if the record fits. Inspect retained records before reloading; no records were pruned.`);
    return this.unavailable;
  }

  assertAvailable() {
    if (this.retired) throw new Error('pstack runtime unloaded');
    if (this.unavailable) throw this.unavailable;
  }

  retire() { this.retired = true; }

  /** @param {Job} job @param {'cancel'|'recover'|'outcome'} kind */
  controlKey(job, kind) {
    return this.controlPrefix + createHash('sha256').update(JSON.stringify([job.id, job.sessionID])).digest('hex') + '/' + kind;
  }

  /** @param {Job} job @param {'cancel'|'recover'} kind */
  async mark(job, kind) {
    await this.storage.set(this.controlKey(job, kind), { id: job.id, sessionID: job.sessionID });
  }

  /** @param {Job} job @returns {Promise<Job>} */
  async effective(job) {
    try {
      const cancelled = await this.storage.get(this.controlKey(job, 'cancel'));
      const recovered = await this.storage.get(this.controlKey(job, 'recover'));
      for (const marker of [cancelled, recovered]) {
        if (marker === undefined) continue;
        if (!marker || typeof marker !== 'object' || Array.isArray(marker)
          || Object.keys(marker).length !== 2 || marker.id !== job.id || marker.sessionID !== job.sessionID) {
          throw new ScheduleStateError('Invalid schedule control marker');
        }
      }
      let result = { ...job };
      if (recovered) result = { ...result, state: 'paused',
        error: result.error ?? 'Runtime stopped during dispatch; inspect session history before scheduling again' };
      if (cancelled) result.state = 'cancelled';
      if (cancelled || recovered || job.state === 'dispatching') {
        // Remaining runs is a bounded dispatch slot, not a reload-local owner token.
        for (let slot = 100; slot >= 1; slot--) {
          const outcome = await this.storage.get(this.controlKey(job, 'outcome') + '/' + slot);
          if (outcome === undefined) continue;
          validateOutcome(outcome, slot);
          if (outcome.id !== job.id || outcome.sessionID !== job.sessionID) {
            throw new ScheduleStateError('Schedule outcome identity or dispatch slot does not match its owner');
          }
          // A paused outcome can carry an earlier receipt. Only successful outcomes prove their own slot.
          const receiptSlot = outcome.receiptSlot ?? (outcome.state === 'paused' ? undefined : slot);
          // A legacy snapshot bounds receipt age by remaining, without identifying its exact slot.
          if (outcome.receipt !== undefined && (result.receipt === undefined
            || (receiptSlot !== undefined && (result.receiptSlot !== undefined
              ? receiptSlot < result.receiptSlot
              : job.receipt === undefined || receiptSlot <= job.remaining)))) {
            result.receipt = outcome.receipt;
            if (receiptSlot !== undefined) result.receiptSlot = receiptSlot;
          }
          if (outcome.error !== undefined) result.error = outcome.error;
        }
      }
      validateRecord(result);
      return result;
    } catch (error) {
      if (error instanceof ScheduleStateError) throw this.quarantine(error);
      throw error;
    }
  }

  /** At most 100 owner-keyed outcomes survive retirement without touching the job.
   * @param {Job} job @param {number} slot */
  async recordOutcome(job, slot) {
    try { validateOutcome(job, slot); }
    catch (error) { throw this.quarantine(error); }
    await this.storage.set(this.controlKey(job, 'outcome') + '/' + slot, job);
  }

  /** @param {Job} job */
  async write(job) {
    try { validateRecord(job); }
    catch (error) { throw this.quarantine(error); }
    if (this.retired) return;
    await this.storage.set(this.prefix + job.id, job);
  }

  /** @template T @param {()=>Promise<T>} operation @returns {Promise<T>} */
  serial(operation) {
    const next = this.tail.then(operation);
    this.tail = next.then(() => {}, () => {});
    return next;
  }

  /** @returns {Promise<Job[]>} */
  async list() {
    this.assertAvailable();
    try {
      /** @type {Job[]} */
      const jobs = [];
      /** @type {string | undefined} */
      let after;
      const cursors = new Set();
      for (let pages = 0; pages < MAX_SCHEDULE_SCAN_PAGES; pages++) {
        const limit = Math.min(SCHEDULE_SCAN_PAGE_SIZE, MAX_RETAINED_SCHEDULES - jobs.length + 1);
        const page = await this.storage.scan({ prefix: this.prefix, limit, after });
        if (!page || !Array.isArray(page.entries) || page.entries.length > limit) {
          throw new ScheduleStateError('Schedule storage returned an invalid or oversized scan page');
        }
        if (jobs.length + page.entries.length > MAX_RETAINED_SCHEDULES) {
          throw new ScheduleStateError(`Schedule history exceeds ${MAX_RETAINED_SCHEDULES} retained records per project namespace. ${retentionRecovery}`);
        }
        for (const entry of page.entries) {
          validateRecord(entry?.value);
          if (entry.key !== this.prefix + entry.value.id) {
            throw new ScheduleStateError('Schedule record identity does not match its storage key');
          }
          jobs.push(await this.effective(entry.value));
        }
        if (page.next == null || page.next === '') return jobs;
        if (typeof page.next !== 'string' || page.next.length > MAX_SCHEDULE_RECORD_BYTES || cursors.has(page.next)) {
          throw new ScheduleStateError('Schedule storage returned an invalid or nonadvancing scan cursor');
        }
        cursors.add(page.next);
        after = page.next;
      }
      throw new ScheduleStateError(`Schedule history scan exceeded ${MAX_SCHEDULE_SCAN_PAGES} pages. ${retentionRecovery}`);
    } catch (error) {
      if (error instanceof ScheduleStateError) throw this.quarantine(error);
      throw error;
    }
  }

  /** @param {Job} job */
  async add(job) {
    return this.serial(async () => {
      this.assertAvailable();
      const bytes = validateRecord(job);
      if (!job.id || job.id.length > 200 || !job.sessionID || job.sessionID.length > 200
        || !job.directory || job.directory.length > 4096 || !job.prompt || job.prompt.length > 16000) {
        throw new Error('New schedule identity or prompt exceeds its bounds (id/sessionID 1..200, directory 1..4096, prompt 1..16000 characters)');
      }
      if (bytes > MAX_SCHEDULE_RECORD_BYTES - LIFECYCLE_RESERVE_BYTES) {
        throw new Error(`New schedule must reserve ${LIFECYCLE_RESERVE_BYTES} JSON bytes for lifecycle metadata`);
      }
      const jobs = await this.list();
      if (jobs.length >= MAX_RETAINED_SCHEDULES) {
        throw new Error(`${MAX_RETAINED_SCHEDULES} retained schedules already exist per project namespace. ${retentionRecovery}`);
      }
      if (jobs.filter(j => j.state === 'armed').length >= MAX_ARMED_SCHEDULES) throw new Error(`${MAX_ARMED_SCHEDULES} active schedules already exist`);
      if (jobs.some(j => j.id === job.id)) throw new Error('Schedule ID is already retained; IDs cannot be reused');
      this.assertAvailable();
      await this.write(job);
      return job;
    });
  }

  /** @param {string} id @param {string} sessionID */
  async cancel(id, sessionID) {
    return this.serial(async () => {
      if (this.retired) throw new Error('pstack runtime unloaded');
      const job = await this.storage.get(this.prefix + id);
      if (!job || job.sessionID !== sessionID) throw new Error('Schedule not owned by this session');
      try { validateRecord(job); }
      catch (error) { throw this.quarantine(error); }
      if (job.id !== id) throw this.quarantine(new ScheduleStateError('Schedule record identity does not match its storage key'));
      const cancelled = { ...job, state: /** @type {const} */ ('cancelled') };
      try { validateRecord(cancelled); }
      catch (error) { throw this.quarantine(error); }
      if (this.retired) throw new Error('pstack runtime unloaded');
      await this.mark(cancelled, 'cancel');
      await this.write(cancelled);
      return cancelled;
    });
  }

  async recover() {
    return this.serial(async () => {
      for (const job of await this.list()) {
        if (this.retired) return;
        if (job.state !== 'dispatching') continue;
        const paused = { ...job, state: /** @type {const} */ ('paused'),
          error: job.error ?? 'Runtime stopped during dispatch; inspect session history before scheduling again' };
        try { validateRecord(paused); }
        catch (error) { throw this.quarantine(error); }
        await this.mark(paused, 'recover');
        await this.write(paused);
      }
    });
  }

  async tick() {
    if (this.retired) return;
    if (this.ticking) return this.ticking;
    this.ticking = this.serial(async () => {
      for (const original of await this.list()) {
        if (this.retired) return;
        let job = { ...original };
        const now = Date.now();
        if (job.state !== 'armed') continue;
        if (now >= job.expiresAt || job.remaining <= 0) {
          job.state = 'done';
        } else if (now >= job.nextAt) {
          const dispatching = { ...job, state: /** @type {const} */ ('dispatching') };
          await this.write(dispatching);
          if (this.retired) return;
          try {
            const receipt = await this.deliver(dispatching);
            const remaining = dispatching.remaining - 1;
            job = { ...dispatching, receipt, receiptSlot: dispatching.remaining, remaining, nextAt: Date.now() + dispatching.intervalMs,
              state: remaining ? 'armed' : 'done' };
          } catch (error) {
            job = { ...dispatching, state: 'paused', error: String(error) };
          }
          if (this.retired) { await this.recordOutcome(job, dispatching.remaining); return; }
          try { await this.write(job); }
          finally { if (this.retired) await this.recordOutcome(job, dispatching.remaining); }
          if (this.retired) return;
          continue;
        }
        await this.write(job);
      }
    }).finally(() => { this.ticking = undefined; });
    return this.ticking;
  }
}
