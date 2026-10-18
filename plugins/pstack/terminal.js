import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export class Terminal {
  constructor() {
    this.child = spawn('python3', [fileURLToPath(new URL('./pty.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    /** @type {Map<number,{resolve:(value:any)=>void,reject:(error:Error)=>void,timer:NodeJS.Timeout}>} */
    this.pending = new Map();
    this.sequence = 0;
    this.stderr = '';
    this.exited = false;
    /** @type {Error | undefined} */
    this.exitError = undefined;
    /** @type {Promise<{closed:true}> | undefined} */
    this.closing = undefined;
    this.finished = new Promise((resolve, reject) => {
      this.child.once('error', error => { this.exitError = error; });
      this.child.once('close', (code, signal) => {
        this.exited = true;
        this.exitError ??= code === 0 ? undefined : new Error(`PTY bridge closure failed (${code ?? signal}). ${this.stderr}`);
        if (this.exitError) reject(this.exitError);
        else resolve(undefined);
      });
    });
    void this.finished.catch(() => {});
    this.child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-4000); });
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(response.id);
        if (response.error) pending.reject(new Error(response.error));
        else pending.resolve(response);
      } catch { this.child.stdin.end(); }
    });
    const fail = (/** @type {Error} */ error) => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
      this.pending.clear();
    };
    this.fail = fail;
    this.child.on('error', fail);
    this.child.on('exit', () => fail(new Error(`PTY bridge exited. ${this.stderr}`)));
    this.child.stdin.on('error', fail);
  }

  /** @param {Record<string,unknown>} request @returns {Promise<any>} */
  request(request) {
    if (this.closing || this.exited) return Promise.reject(new Error('Terminal is closing or closed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.close();
        reject(new Error('Terminal operation timed out; closure requested'));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    });
  }

  close() {
    if (this.exited && !this.exitError) return Promise.resolve(/** @type {{closed:true}} */ ({ closed: true }));
    if (!this.closing) {
      this.fail(new Error('Terminal closure requested'));
      this.child.stdin.end();
      this.closing = (async () => {
        let timer;
        try {
          await Promise.race([this.finished, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('PTY bridge closure was not confirmed within 5 seconds')), 5000);
          })]);
          return /** @type {{closed:true}} */ ({ closed: true });
        } finally { clearTimeout(timer); }
      })();
      void this.closing.catch(() => {});
    }
    return this.closing;
  }
}
