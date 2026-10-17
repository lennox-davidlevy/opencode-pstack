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
    this.child.on('error', fail);
    this.child.on('exit', () => fail(new Error(`PTY bridge exited. ${this.stderr}`)));
    this.child.stdin.on('error', fail);
  }

  /** @param {Record<string,unknown>} request @returns {Promise<any>} */
  request(request) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.close();
        reject(new Error('Terminal operation timed out; bridge closed'));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    });
  }

  close() { this.child.stdin.end(); }
}
