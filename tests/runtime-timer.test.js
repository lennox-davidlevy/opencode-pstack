import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as turn, setTimeout as sleep } from 'node:timers/promises';
import plugin from '../plugins/pstack/index.js';
import { makeTempDir } from './helpers/temp.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(t) {
  const directory = await makeTempDir('pstack-runtime-timer-');
  const f = { directory };
  t.after(async () => {
    try {
      await f.release?.();
      await f.cleanup?.();
      await turn();
      const pids = await readFile(join(directory, 'pids'), 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      for (const pid of pids.trim().split('\n').filter(Boolean).map(Number)) {
        let running = true;
        for (let attempt = 0; attempt < 400; attempt++) {
          try { process.kill(pid, 0); }
          catch (error) { if (error.code !== 'ESRCH') throw error; running = false; break; }
          await sleep(5);
        }
        assert.equal(running, false, `Fixture transport ${pid} must exit before removing its directory`);
      }
      await rm(directory, { recursive: true, force: true });
      await assert.rejects(readFile(directory), { code: 'ENOENT' });
    } finally { f.restore?.(); }
  });
  const prefix = createHash('sha256').update(directory).digest('hex').slice(0, 24) + '/loop/';
  const records = new Map();
  const tools = new Map();
  const errors = [];
  const shutdowns = [];
  const report = console.error.bind(console);
  t.mock.method(console, 'error', (...args) => {
    if (args[0] === 'pstack schedule storage failure') errors.push(args);
    else if (args[0] === 'pstack scheduler drain incomplete') shutdowns.push(args);
    else report(...args);
  });
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 100 });
  Object.assign(f, { prefix, records, tools, errors, shutdowns, scans: 0 });
  f.ctx = {
    location: { directory },
    permission: {
      async hook(name, hook) { assert.equal(name, 'evaluate'); assert.equal(typeof hook, 'function'); },
      async assert(...args) { await f.onPermission?.(...args); },
    },
    storage: {
      async get(key) { return structuredClone(records.get(key)); },
      async set(key, value) {
        await f.onSet?.(key, value);
        records.set(key, structuredClone(value));
      },
      async scan({ prefix, limit, after }) {
        f.scans++;
        await f.onScan?.();
        const keys = [...records.keys()].filter(key => key.startsWith(prefix) && (!after || key > after)).sort();
        const selected = keys.slice(0, limit);
        return { entries: selected.map(key => ({ key, value: structuredClone(records.get(key)) })),
          next: keys.length > selected.length ? selected.at(-1) : undefined };
      },
    },
    tool: { async transform(edit) {
      edit({ namespace() {}, add(tool) { tools.set(tool.name, tool); } });
      await f.onRegister?.();
    } },
  };
  f.setup = async () => {
    const cleanup = await plugin.setup(f.ctx);
    f.cleanup = cleanup;
    return cleanup;
  };
  f.advance = async milliseconds => { t.mock.timers.tick(milliseconds); await turn(); };
  return f;
}

test('timer maintenance waits for held storage and resumes without catch-up work', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const cleanup = await f.setup();
  assert.ok(f.tools.has('loop'));
  const held = deferred();
  f.onScan = () => held.promise;
  f.release = () => held.resolve();
  await f.advance(1000);
  const scans = f.scans;
  await f.advance(100_000);
  assert.equal(f.scans, scans);
  f.onScan = undefined;
  held.resolve();
  await turn();
  assert.equal(f.scans, scans, 'missed intervals are not replayed');
  await f.advance(1000);
  assert.equal(f.scans, scans + 1);
  await cleanup();
  await f.advance(100_000);
  assert.equal(f.scans, scans + 1, 'unload stops future maintenance');
  assert.deepEqual(f.errors, []);
});

test('one stalled scan failure is reported once and the timer recovers', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await f.setup();
  const held = deferred();
  f.onScan = () => held.promise;
  f.release = () => held.resolve();
  await f.advance(1000);
  const scans = f.scans;
  await f.advance(100_000);
  assert.equal(f.scans, scans);
  f.onScan = undefined;
  held.reject(new Error('fixture storage unavailable'));
  await turn();
  assert.equal(f.errors.length, 1, 'one pending maintenance call must not accumulate failure handlers');
  assert.match(f.errors[0].join(' '), /fixture storage unavailable/);
  await f.advance(1000);
  assert.equal(f.scans, scans + 1, 'a rejected pass must release timer backpressure');
});

async function deliveryTransport(f) {
  const release = join(f.directory, 'release');
  const started = join(f.directory, 'started');
  await writeFile(join(f.directory, 'opencode'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(path.join(__dirname, 'pids'), process.pid + '\\n');
const route = process.argv[4];
let response;
if (process.argv[2] !== 'api') process.exit(90);
if (route === '/api/session/ses_owner') response = { data: { agent: 'poteto', location: { directory: __dirname }, time: {} } };
else if (route === '/api/session/ses_owner/permission') response = { data: { effect: 'allow' } };
else if (route === '/api/session/ses_owner/inbox') response = { data: [] };
else if (route === '/api/session/ses_owner/prompt') {
  fs.appendFileSync(path.join(__dirname, 'started'), 'started');
  const timer = setInterval(() => {
    if (!fs.existsSync(path.join(__dirname, 'release'))) return;
    clearInterval(timer);
    process.stdout.write(JSON.stringify({ data: { id: 'msg_receipt' } }));
  }, 5);
} else process.exit(91);
if (response) process.stdout.write(JSON.stringify(response));
`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${f.directory}:${previousPath}`;
  f.release = () => writeFile(release, 'released');
  f.restore = () => { process.env.PATH = previousPath; };
  return {
    async started() {
      for (let attempt = 0; attempt < 400; attempt++) {
        try { await readFile(started); return; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await sleep(5);
      }
      assert.fail('fixture delivery did not start');
    },
    release: () => writeFile(release, 'released'),
  };
}

async function terminalTransport(f) {
  const closed = join(f.directory, 'terminal-closed');
  await writeFile(join(f.directory, 'python3'), `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
fs.appendFileSync(${JSON.stringify(join(f.directory, 'pids'))}, process.pid + '\\n');
fs.writeFileSync(${JSON.stringify(join(f.directory, 'terminal-started'))}, 'started');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id: request.id, started: true }) + '\\n');
});
process.stdin.on('end', () => fs.writeFileSync(${JSON.stringify(closed)}, 'closed'));
`, { mode: 0o755 });
  return async () => {
    for (let attempt = 0; attempt < 400; attempt++) {
      try { await readFile(closed); return; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await sleep(5);
    }
    assert.fail('fixture terminal was not closed');
  };
}

test('unload closes owned terminals before the bounded stalled-storage drain', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await deliveryTransport(f);
  const terminalClosed = await terminalTransport(f);
  const cleanup = await f.setup();
  const context = { sessionID: 'ses_owner', agent: 'poteto', signal: new AbortController().signal };
  const terminal = await f.tools.get('terminal').execute({ action: 'start', command: 'fixture-only' }, context);
  assert.equal(JSON.parse(terminal.content).started, true);
  const held = deferred();
  f.onScan = () => held.promise;
  f.release = () => held.resolve();
  await f.advance(1000);
  const scans = f.scans;
  let unloaded = false;
  const unloading = cleanup().then(() => { unloaded = true; });
  await terminalClosed();
  assert.equal(unloaded, false, 'terminal shutdown cannot depend on scheduler drain');
  await assert.rejects(f.tools.get('loop').execute({ action: 'list' }, context), /runtime unloaded/);
  await f.advance(999);
  assert.equal(unloaded, false, 'an admitted pass gets up to one second to drain');
  await f.advance(1);
  assert.equal(unloaded, true, 'stalled SDK storage cannot hold unload indefinitely');
  await unloading;
  assert.equal(f.shutdowns.length, 1);
  assert.match(f.shutdowns[0].join(' '), /still be running/);
  f.onScan = undefined;
  held.reject(new Error('fixture late storage failure'));
  await turn();
  assert.equal(f.errors.length, 1, 'late rejection remains handled after unload returns');
  assert.match(f.errors[0].join(' '), /fixture late storage failure/);
  await cleanup();
  await f.advance(100_000);
  assert.equal(f.scans, scans, 'late settlement must not rearm maintenance');
  assert.equal(f.shutdowns.length, 1, 'repeated cleanup shares the same drain');
});

test('unload does not admit delivery after a stalled dispatch-state write settles', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const transport = await deliveryTransport(f);
  const cleanup = await f.setup();
  const key = f.prefix + 'bounded';
  f.records.set(key, { id: 'bounded', sessionID: 'ses_owner', directory: f.directory,
    prompt: 'Check the fixture only', intervalMs: 1000, remaining: 2,
    nextAt: 100, expiresAt: 1_000_000, state: 'armed' });
  const held = deferred();
  const persisted = deferred();
  f.onSet = async (_key, value) => {
    if (value.state === 'dispatching') { await held.promise; persisted.resolve(); }
  };
  f.release = async () => { held.resolve(); await transport.release(); };
  await f.advance(1000);
  const scans = f.scans;
  let unloaded = false;
  const unloading = cleanup().then(() => { unloaded = true; });
  await f.advance(1000);
  assert.equal(unloaded, true);
  await unloading;
  held.resolve();
  await persisted.promise;
  await turn();
  assert.equal(f.records.get(key).state, 'dispatching', 'retirement does not issue a new mutable write');
  assert.equal(f.records.get(key).remaining, 2);
  await assert.rejects(readFile(join(f.directory, 'started')), { code: 'ENOENT' });
  await f.advance(100_000);
  assert.equal(f.scans, scans);
  assert.equal(f.shutdowns.length, 1);
  assert.deepEqual(f.errors, []);
});

for (const action of ['schedule', 'terminal']) {
  test(`unload refuses ${action} admission after a pending permission settles`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    await deliveryTransport(f);
    await terminalTransport(f);
    const cleanup = await f.setup();
    const held = deferred();
    const started = deferred();
    f.onPermission = async () => { started.resolve(); await held.promise; };
    f.release = () => held.resolve();
    const context = { sessionID: 'ses_owner', agent: 'poteto', signal: new AbortController().signal };
    const input = action === 'schedule'
      ? { action, prompt: 'Fixture only', intervalSeconds: 1, maxRuns: 1, durationSeconds: 60 }
      : { action: 'start', command: 'fixture-only' };
    const pending = f.tools.get(action === 'schedule' ? 'loop' : 'terminal').execute(input, context);
    const rejected = assert.rejects(pending, /runtime unloaded/);
    await started.promise;
    await cleanup();
    held.resolve();
    await rejected;
    assert.equal(f.records.size, 0, 'no new schedule is persisted after admission closes');
    await assert.rejects(readFile(join(f.directory, 'terminal-started')), { code: 'ENOENT' });
    await f.advance(100_000);
    assert.deepEqual(f.shutdowns, []);
    assert.deepEqual(f.errors, []);
  });
}

test('timer resumes after held delivery completes without replaying elapsed intervals', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const transport = await deliveryTransport(f);
  await f.setup();
  const key = f.prefix + 'bounded';
  f.records.set(key, { id: 'bounded', sessionID: 'ses_owner', directory: f.directory,
    prompt: 'Check the fixture only', intervalMs: 1000, remaining: 2,
    nextAt: 100, expiresAt: 1_000_000, state: 'armed' });
  const settled = deferred();
  f.onSet = async (_key, value) => { if (value.receipt) settled.resolve(); };
  await f.advance(1000);
  await transport.started();
  const scans = f.scans;
  await f.advance(100_000);
  assert.equal(f.scans, scans);
  await transport.release();
  await settled.promise;
  await turn();
  assert.equal(f.records.get(key).receipt, 'msg_receipt');
  assert.equal(f.records.get(key).remaining, 1);
  assert.equal(f.scans, scans, 'elapsed intervals must not become queued maintenance');
  await f.advance(1000);
  assert.equal(f.scans, scans + 1, 'a completed delivery releases timer backpressure');
  assert.deepEqual(f.errors, []);
});

test('unload bounds held delivery without retrying uncertain dispatch or losing late failures', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const transport = await deliveryTransport(f);
  const cleanup = await f.setup();
  const key = f.prefix + 'bounded';
  f.records.set(key, { id: 'bounded', sessionID: 'ses_owner', directory: f.directory,
    prompt: 'Check the fixture only', intervalMs: 1000, remaining: 2,
    nextAt: 100, expiresAt: 1_000_000, state: 'armed' });
  const settled = deferred();
  f.onSet = async (_key, value) => {
    if (value.receipt) { settled.resolve(); throw new Error('fixture completion write failed'); }
  };
  await f.advance(1000);
  await transport.started();
  assert.equal(f.records.get(key).state, 'dispatching');
  const scans = f.scans;
  await f.advance(100_000);
  assert.equal(f.scans, scans);
  let unloaded = false;
  const unloading = cleanup().then(() => { unloaded = true; });
  await turn();
  assert.equal(unloaded, false, 'unload allows a bounded drain for an admitted delivery');
  await f.advance(1000);
  assert.equal(unloaded, true, 'unload does not wait indefinitely for delivery');
  await unloading;
  assert.equal(f.shutdowns.length, 1);
  assert.equal(f.records.get(key).state, 'dispatching', 'timeout must not claim the delivery stopped');
  assert.equal(f.records.get(key).remaining, 2);
  await transport.release();
  await settled.promise;
  await turn();
  assert.equal(f.errors.length, 1, 'held delivery must not retain a handler per interval');
  assert.match(f.errors[0].join(' '), /fixture completion write failed/);
  assert.equal(f.records.get(key).state, 'dispatching', 'a failed completion write remains uncertain');
  assert.equal(f.records.get(key).remaining, 2);
  await f.advance(100_000);
  assert.equal(f.scans, scans);
});

test('reload cancellation dominates a retired delivery and preserves its late receipt', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const transport = await deliveryTransport(f);
  const cleanup = await f.setup();
  const key = f.prefix + 'bounded';
  f.records.set(key, retained(f, 'bounded', 'armed'));
  await f.advance(1000);
  await transport.started();
  const unloading = cleanup();
  await f.advance(1000);
  await unloading;
  await f.setup();
  const context = { sessionID: 'ses_owner', agent: 'poteto', signal: new AbortController().signal };
  const list = async () => JSON.parse((await f.tools.get('loop').execute({ action: 'list' }, context)).content);
  assert.equal((await list())[0].state, 'paused');
  await f.tools.get('loop').execute({ action: 'cancel', id: 'bounded' }, context);
  const settled = deferred();
  f.onSet = async (_key, value) => { if (value.receipt) settled.resolve(); };
  await transport.release();
  await settled.promise;
  await turn();
  const [cancelled] = await list();
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.receipt, 'msg_receipt');
  assert.equal(f.records.get(key).state, 'cancelled', 'retired delivery must not rewrite the mutable job');
  await f.advance(10_000);
  await turn();
  assert.equal(await readFile(join(f.directory, 'started'), 'utf8'), 'started');
  assert.equal((await list())[0].state, 'cancelled');
  assert.deepEqual(f.errors, []);
});

for (const phase of ['dispatch', 'completion']) {
  test(`cancellation survives an old ${phase} write settling after replacement setup`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    const transport = await deliveryTransport(f);
    const cleanup = await f.setup();
    const key = f.prefix + 'bounded';
    f.records.set(key, retained(f, 'bounded', 'armed'));
    const held = deferred();
    const started = deferred();
    const settled = deferred();
    let blocked = false;
    f.onSet = async (written, value) => {
      if (written !== key || blocked || (phase === 'dispatch' ? value.state !== 'dispatching' : !value.receipt)) return;
      blocked = true;
      started.resolve();
      await held.promise;
      settled.resolve();
    };
    f.release = async () => { held.resolve(); await transport.release(); };
    await f.advance(1000);
    if (phase === 'completion') { await transport.started(); await transport.release(); }
    await started.promise;
    const unloading = cleanup();
    await f.advance(1000);
    await unloading;
    const replacementCleanup = await f.setup();
    const context = { sessionID: 'ses_owner', agent: 'poteto', signal: new AbortController().signal };
    await f.tools.get('loop').execute({ action: 'cancel', id: 'bounded' }, context);
    held.resolve();
    await settled.promise;
    await turn();
    assert.equal(f.records.get(key).state, phase === 'completion' ? 'armed' : 'dispatching',
      'the uncancellable storage call really overwrote the mutable snapshot');
    const list = async () => JSON.parse((await f.tools.get('loop').execute({ action: 'list' }, context)).content);
    assert.equal((await list())[0].state, 'cancelled');
    if (phase === 'completion') assert.equal((await list())[0].receipt, 'msg_receipt');
    await f.advance(10_000);
    await replacementCleanup();
    await f.setup();
    await f.advance(1000);
    assert.equal((await list())[0].state, 'cancelled', 'control facts survive another reload');
    if (phase === 'completion') assert.equal(await readFile(join(f.directory, 'started'), 'utf8'), 'started');
    else await assert.rejects(readFile(join(f.directory, 'started')), { code: 'ENOENT' });
    assert.deepEqual(f.errors, []);
  });
}

test('failed registration never starts timer maintenance', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const registration = deferred();
  const started = deferred();
  f.onRegister = () => { started.resolve(); return registration.promise; };
  const setup = plugin.setup(f.ctx);
  const failed = assert.rejects(setup, /fixture registration failed/);
  f.release = async () => { registration.reject(new Error('fixture registration failed')); await failed; };
  await started.promise;
  const scans = f.scans;
  await f.advance(100_000);
  assert.equal(f.scans, scans, 'maintenance must wait for successful registration');
  registration.reject(new Error('fixture registration failed'));
  await failed;
  await f.advance(100_000);
  assert.equal(f.scans, scans, 'failed setup must not leave a live timer');
});

function retained(f, id, state = 'done') {
  return { id, sessionID: 'ses_owner', directory: f.directory, prompt: 'Fixture only',
    intervalMs: 1000, remaining: 2, nextAt: 100, expiresAt: 1_000_000, state };
}

test('overflow at setup quarantines scheduling but registers unrelated tools and ownership-checked cancellation', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await deliveryTransport(f);
  for (let i = 0; i < 101; i++) {
    const record = retained(f, String(i).padStart(4, '0'), i === 0 ? 'armed' : 'done');
    if (i === 1) record.sessionID = 'ses_other';
    f.records.set(f.prefix + record.id, record);
  }
  const before = structuredClone([...f.records]);
  await f.setup();
  for (const name of ['history_list', 'history_read', 'loop', 'worker', 'worker_review', 'terminal']) {
    assert.ok(f.tools.has(name));
  }
  assert.deepEqual([...f.records], before);
  const context = { sessionID: 'ses_owner', agent: 'poteto', signal: new AbortController().signal };
  const list = await f.tools.get('worker').execute({ action: 'list' }, context);
  assert.ok(list.content);
  await assert.rejects(f.tools.get('worker').execute({ action: 'stop', id: '00000000-0000-4000-8000-000000000000' }, context), error => {
    assert.match(String(error.cause ?? error), /not owned/);
    return true;
  });
  await assert.rejects(f.tools.get('terminal').execute({ action: 'read', id: 'missing' }, context), /not owned/);
  await assert.rejects(f.tools.get('loop').execute({ action: 'schedule', prompt: 'Fixture only',
    intervalSeconds: 1, maxRuns: 1, durationSeconds: 60 }, context), /Scheduler unavailable \(quarantined\).*exceeds 100 retained records/);
  await assert.rejects(f.tools.get('loop').execute({ action: 'list' }, context), /quarantined/);
  await assert.rejects(f.tools.get('loop').execute({ action: 'cancel', id: '0001' }, context), /not owned/);
  const scans = f.scans;
  await f.advance(100_000);
  assert.equal(f.scans, scans, 'quarantine must not start maintenance');
  assert.equal(f.errors.length, 1);
  assert.deepEqual([...f.records], before);
  await f.tools.get('loop').execute({ action: 'cancel', id: '0000' }, context);
  assert.deepEqual([...f.records].filter(([key]) => key.startsWith(f.prefix)), before.map(([key, value]) => [key,
    key === f.prefix + '0000' ? { ...value, state: 'cancelled' } : value]));
  await assert.rejects(readFile(join(f.directory, 'started')), { code: 'ENOENT' });
});

for (const invalid of ['overflow', 'numeric']) {
  test(`later ${invalid} state quarantines maintenance once without delivery or mutation`, { timeout: 10000 }, async t => {
    const f = await fixture(t);
    await deliveryTransport(f);
    await f.setup();
    for (let i = 0; i < (invalid === 'overflow' ? 101 : 1); i++) {
      const record = retained(f, String(i), 'armed');
      if (invalid === 'numeric') record.intervalMs = -1;
      f.records.set(f.prefix + record.id, record);
    }
    const before = structuredClone([...f.records]);
    await f.advance(1000);
    const scans = f.scans;
    assert.equal(f.errors.length, 1);
    await f.advance(100_000);
    assert.equal(f.scans, scans);
    assert.equal(f.errors.length, 1, 'invalid persisted state must not be retried or logged indefinitely');
    assert.deepEqual([...f.records], before);
    const context = { sessionID: 'ses_owner', agent: 'poteto', signal: new AbortController().signal };
    await assert.rejects(f.tools.get('loop').execute({ action: 'schedule', prompt: 'Fixture only',
      intervalSeconds: 1, maxRuns: 1, durationSeconds: 60 }, context), /quarantined/);
    await assert.rejects(readFile(join(f.directory, 'started')), { code: 'ENOENT' });
  });
}

test('registered scheduling enforces integer tool ranges while accepting both inclusive boundaries', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await deliveryTransport(f);
  await f.setup();
  const context = { sessionID: 'ses_owner', agent: 'poteto', signal: new AbortController().signal };
  const input = { action: 'schedule', prompt: 'Fixture only', intervalSeconds: 1, maxRuns: 1, durationSeconds: 1 };
  let permissions = 0;
  f.onPermission = async () => { permissions++; };
  for (const [key, maximum] of [['intervalSeconds', 86400], ['maxRuns', 100], ['durationSeconds', 604800]]) {
    for (const value of [0, -1, 1.5, maximum + 1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1']) {
      await assert.rejects(f.tools.get('loop').execute({ ...input, [key]: value }, context), /Scheduling needs/);
    }
  }
  assert.equal(permissions, 0);
  assert.equal(f.records.size, 0);
  const minimum = JSON.parse((await f.tools.get('loop').execute(input, context)).content);
  const maximum = JSON.parse((await f.tools.get('loop').execute({ ...input,
    intervalSeconds: 86400, maxRuns: 100, durationSeconds: 604800 }, context)).content);
  assert.equal(minimum.intervalMs, 1000);
  assert.equal(minimum.remaining, 1);
  assert.equal(minimum.expiresAt, 1100);
  assert.equal(maximum.intervalMs, 86400000);
  assert.equal(maximum.remaining, 100);
  assert.equal(maximum.expiresAt, 604800100);
  assert.equal(f.records.size, 2);
  assert.equal(permissions, 2);
});
