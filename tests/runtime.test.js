import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Loops } from '../plugins/pstack/loops.js';
import { Terminal } from '../plugins/pstack/terminal.js';
import { historyList, scopedSession } from '../plugins/pstack/api.js';
import { deliverWakeup } from '../plugins/pstack/wakeup.js';
import { makeTempDir } from './helpers/temp.js';

test('temporary fixtures use an existing preferred parent or fall back without creating it', async t => {
  const parent = await makeTempDir('pstack-temp-test-');
  t.after(() => rm(parent, { recursive: true, force: true }));
  const preferred = await makeTempDir('preferred-', parent);
  assert.equal(dirname(preferred), parent);
  const missing = join(parent, 'absent-parent');
  const fallback = await makeTempDir('pstack-fallback-', missing);
  t.after(async () => {
    await rm(fallback, { recursive: true, force: true });
    await assert.rejects(lstat(fallback), { code: 'ENOENT' });
  });
  assert.equal(dirname(fallback), resolve(tmpdir()));
  await assert.rejects(lstat(missing), { code: 'ENOENT' });
  for (const directory of [preferred, fallback]) {
    await writeFile(join(directory, 'fixture.txt'), 'usable fixture');
    assert.equal(await readFile(join(directory, 'fixture.txt'), 'utf8'), 'usable fixture');
  }
});

async function diskStore(t) {
  const dir = await makeTempDir('pstack-loop-test-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'storage.json');
  await writeFile(path, '{}');
  return {
    async get(key) { return JSON.parse(await readFile(path, 'utf8'))[key]; },
    async set(key, value) {
      const data = JSON.parse(await readFile(path, 'utf8'));
      data[key] = value;
      await writeFile(path, JSON.stringify(data));
    },
    async scan({ prefix }) {
      return { entries: Object.entries(JSON.parse(await readFile(path, 'utf8')))
        .filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })) };
    },
  };
}

const job = (id, overrides = {}) => ({ id, sessionID: 'ses_owner', directory: '/project',
  prompt: 'Check one predicate', intervalMs: 1000, remaining: 2,
  nextAt: 100, expiresAt: Date.now() + 60_000, state: 'armed', ...overrides });

test('durable schedules bound delivery, serialize ticks, cancel, expire, and pause uncertainty', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = await diskStore(t);
  const delivered = [];
  const deliver = async j => { delivered.push(j.id); return `receipt-${delivered.length}`; };
  const initial = new Loops(store, 'project/', deliver);
  await initial.add(job('bounded'));
  const resumed = new Loops(store, 'project/', deliver);
  await resumed.recover();
  await Promise.all([resumed.tick(), resumed.tick()]);
  assert.deepEqual(delivered, ['bounded']);
  t.mock.timers.tick(1500);
  await resumed.tick();
  t.mock.timers.tick(1500);
  await resumed.tick();
  assert.deepEqual(delivered, ['bounded', 'bounded']);
  assert.equal((await store.get('project/bounded')).state, 'done');
  assert.equal((await store.get('project/bounded')).receipt, 'receipt-2');
  await resumed.add(job('cancelled'));
  await assert.rejects(resumed.cancel('cancelled', 'ses_other'), /not owned/);
  await resumed.cancel('cancelled', 'ses_owner');
  await resumed.add(job('expired', { expiresAt: 99 }));
  await resumed.add(job('uncertain', { state: 'dispatching' }));
  await resumed.recover();
  await resumed.tick();
  assert.deepEqual(delivered, ['bounded', 'bounded']);
  assert.equal((await store.get('project/expired')).state, 'done');
  assert.equal((await store.get('project/uncertain')).state, 'paused');
  const failing = new Loops(store, 'failure/', async () => { throw new Error('transport lost'); });
  await failing.add(job('lost'));
  await failing.tick();
  await failing.tick();
  assert.equal((await store.get('failure/lost')).state, 'paused');
});

test('a slow earlier delivery cannot admit a later expired job', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const delivered = [];
  const store = await diskStore(t);
  const loops = new Loops(store, 'slow/', async j => {
    delivered.push(j.id);
    t.mock.timers.tick(500);
    return 'receipt';
  });
  await loops.add(job('first'));
  await loops.add(job('expired-behind-first', { expiresAt: 300 }));
  await loops.tick();
  assert.deepEqual(delivered, ['first']);
  assert.equal((await store.get('slow/expired-behind-first')).state, 'done');
});

test('wakeup admission rejects queued predecessors and expiry during preflight', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const directory = await makeTempDir('pstack-wakeup-test-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pending = [];
  const admitted = [];
  let expireDuringPreflight = false;
  const request = async (method, path, body) => {
    if (path.endsWith('/permission')) return { data: { effect: 'allow' } };
    if (path.endsWith('/inbox')) {
      if (expireDuringPreflight) t.mock.timers.tick(500);
      return { data: pending };
    }
    if (path.endsWith('/prompt')) { admitted.push(body); return { data: { id: 'msg_receipt' } }; }
    return { data: { agent: 'poteto', location: { directory }, time: {} } };
  };
  const scheduled = job('queued', { directory, expiresAt: 300 });
  pending.push({ type: 'user', payload: { text: 'Earlier wakeup', metadata: { pstackLoop: 'queued' } } });
  await assert.rejects(deliverWakeup(scheduled, request), /still pending/);
  assert.equal(admitted.length, 0);
  pending.length = 0;
  assert.equal(await deliverWakeup(scheduled, request), 'msg_receipt');
  assert.equal(admitted[0].delivery, 'queue');
  expireDuringPreflight = true;
  await assert.rejects(deliverWakeup(scheduled, request), /expired during preflight/);
  assert.equal(admitted.length, 1);
});

test('PTY close stops a signal-resistant descendant even when its leader exits', { timeout: 10000 }, async () => {
  const terminal = new Terminal();
  const exited = once(terminal.child, 'exit');
  let pid;
  try {
    const script = 'import os,signal,time\npid=os.fork()\nif pid == 0:\n signal.signal(signal.SIGTERM,signal.SIG_IGN)\n signal.signal(signal.SIGHUP,signal.SIG_IGN)\n print("DESCENDANT="+str(os.getpid()),flush=True)\n time.sleep(60)\nelse:\n time.sleep(60)';
    let output = (await terminal.request({ action: 'start', cwd: process.cwd(), argv: ['python3', '-u', '-c', script] })).output;
    for (let i = 0; i < 10 && !output.includes('DESCENDANT='); i++) output += (await terminal.request({ action: 'read' })).output;
    pid = Number(output.match(/DESCENDANT=(\d+)/)?.[1]);
    assert.ok(pid > 0);
    terminal.close();
    await exited;
    // Linux may briefly retain the reparented zombie, which is no longer running.
    try { assert.match(await readFile(`/proc/${pid}/stat`, 'utf8'), /\) Z /); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  } finally {
    terminal.close();
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await exited;
  }
});

test('history rejects other-directory sessions and forged pagination without leaking content', async t => {
  const root = await makeTempDir('pstack-history-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const other = join(root, 'other');
  await mkdir(other);
  const session = { id: 'ses_known', title: 'In scope', location: { directory: root } };
  const local = async () => ({ data: session });
  assert.equal((await scopedSession(root, 'ses_known', local)).title, 'In scope');
  await assert.rejects(scopedSession(root, 'ses_other', async () => ({ data: { ...session, location: { directory: other } } })), /outside/);
  const page = await historyList(root, 10, undefined, async () => ({ data: [session], cursor: { next: 'page2' } }));
  assert.equal(page.data[0].id, 'ses_known');
  assert.equal(page.cursor.next, 'page2');
  await assert.rejects(historyList(root, 10, 'foreign', async () => ({ data: [{ ...session, location: { directory: other } }] })), /another directory/);
});

test('PTY drives a real interactive process, resizes, captures output, and closes', async () => {
  const terminal = new Terminal();
  const exited = once(terminal.child, 'exit');
  try {
    let output = (await terminal.request({ action: 'start', cwd: process.cwd(), argv: [
      'python3', '-u', '-c',
      'import os; print("TTY=" + str(os.isatty(0)), flush=True); value=input(); print("VALUE="+value); print("COLS="+str(os.get_terminal_size().columns))',
    ] })).output;
    await terminal.request({ action: 'resize', rows: 30, cols: 91 });
    output += (await terminal.request({ action: 'send', text: 'parity\n' })).output;
    for (let i = 0; i < 10 && !output.includes('COLS=91'); i++) output += (await terminal.request({ action: 'read' })).output;
    assert.match(output, /TTY=True/);
    assert.match(output, /VALUE=parity/);
    assert.match(output, /COLS=91/);
  } finally {
    terminal.close();
    await exited;
  }
});
