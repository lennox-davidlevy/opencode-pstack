/** @typedef {{id:string, sessionID:string, directory:string, prompt:string,
 * intervalMs:number, remaining:number, nextAt:number, expiresAt:number,
 * state:'armed'|'dispatching'|'paused'|'done'|'cancelled', error?:string, receipt?:string}} Job
 */

/** Durable bounded schedule. An uncertain dispatch is never retried automatically. */
export class Loops {
  /** @param {{get:(key:string)=>Promise<any>,set:(key:string,value:any)=>Promise<void>,scan:(input:any)=>Promise<any>}} storage
   * @param {string} prefix @param {(job:Job)=>Promise<string>} deliver
   */
  constructor(storage, prefix, deliver) {
    this.storage = storage;
    this.prefix = prefix;
    this.deliver = deliver;
    this.tail = Promise.resolve();
  }

  /** @template T @param {()=>Promise<T>} operation @returns {Promise<T>} */
  serial(operation) {
    const next = this.tail.then(operation);
    this.tail = next.then(() => {}, () => {});
    return next;
  }

  /** @returns {Promise<Job[]>} */
  async list() {
    const jobs = [];
    let after;
    do {
      const page = await this.storage.scan({ prefix: this.prefix, limit: 100, after });
      jobs.push(...page.entries.map((/** @type {any} */ e) => e.value));
      after = page.next;
    } while (after);
    return jobs;
  }

  /** @param {Job} job */
  async add(job) {
    return this.serial(async () => {
      if ((await this.list()).filter(j => j.state === 'armed').length >= 20) throw new Error('20 active schedules already exist');
      await this.storage.set(this.prefix + job.id, job);
      return job;
    });
  }

  /** @param {string} id @param {string} sessionID */
  async cancel(id, sessionID) {
    return this.serial(async () => {
      const job = await this.storage.get(this.prefix + id);
      if (!job || job.sessionID !== sessionID) throw new Error('Schedule not owned by this session');
      job.state = 'cancelled';
      await this.storage.set(this.prefix + id, job);
      return job;
    });
  }

  async recover() {
    for (const job of await this.list()) {
      if (job.state !== 'dispatching') continue;
      job.state = 'paused';
      job.error = 'Runtime stopped during dispatch; inspect session history before scheduling again';
      await this.storage.set(this.prefix + job.id, job);
    }
  }

  async tick() {
    return this.serial(async () => {
      for (const job of await this.list()) {
        const now = Date.now();
        if (job.state !== 'armed') continue;
        if (now >= job.expiresAt || job.remaining <= 0) {
          job.state = 'done';
        } else if (now >= job.nextAt) {
          job.state = 'dispatching';
          await this.storage.set(this.prefix + job.id, job);
          try {
            job.receipt = await this.deliver(job);
            job.remaining--;
            job.nextAt = Date.now() + job.intervalMs;
            job.state = job.remaining ? 'armed' : 'done';
          } catch (error) {
            job.state = 'paused';
            job.error = String(error);
          }
        }
        await this.storage.set(this.prefix + job.id, job);
      }
    });
  }
}
