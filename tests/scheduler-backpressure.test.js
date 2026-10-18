import test from 'node:test';
import assert from 'node:assert/strict';
import { Loops } from '../plugins/pstack/loops.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function memoryStore(onScan = async () => {}) {
  const data = new Map();
  const calls = { scans: 0 };
  return {
    calls,
    async get(key) { return structuredClone(data.get(key)); },
    async set(key, value) { data.set(key, structuredClone(value)); },
    async scan({ prefix }) {
      calls.scans++;
      await onScan();
      return { entries: [...data].filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value: structuredClone(value) })) };
    },
  };
}

const job = (id = 'bounded') => ({ id, sessionID: 'ses_owner', directory: '/project',
  prompt: 'Check one predicate', intervalMs: 1000, remaining: 2,
  nextAt: 100, expiresAt: 60_000, state: 'armed' });

test('many ticks during slow delivery perform bounded storage maintenance', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = memoryStore();
  const started = deferred();
  const delivery = deferred();
  const delivered = [];
  const loops = new Loops(store, 'project/', async j => {
    delivered.push(j.id);
    started.resolve();
    return delivery.promise;
  });
  await loops.add(job());
  const scansBefore = store.calls.scans;
  const first = loops.tick();
  const queued = Array.from({ length: 50 }, () => loops.tick());
  await started.promise;
  const ticks = [...queued, ...Array.from({ length: 50 }, () => loops.tick())];
  assert.equal((await store.get('project/bounded')).state, 'dispatching');
  t.mock.timers.tick(5000);
  delivery.resolve('receipt-1');
  await Promise.all([first, ...ticks]);
  assert.ok(store.calls.scans - scansBefore <= 2,
    `concurrent ticks performed ${store.calls.scans - scansBefore} storage scans`);
  assert.deepEqual(delivered, ['bounded']);
  assert.equal((await loops.list())[0].remaining, 1);
  await loops.tick();
  assert.deepEqual(delivered, ['bounded']);
  t.mock.timers.tick(1000);
  await loops.tick();
  assert.deepEqual(delivered, ['bounded', 'bounded']);
  assert.equal((await loops.list())[0].state, 'done');
});

test('cancellation waits for active delivery but not redundant tick maintenance', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const started = deferred();
  const delivery = deferred();
  const redundantScan = deferred();
  const scanRelease = deferred();
  let blockScans = false;
  const store = memoryStore(async () => {
    if (!blockScans) return;
    redundantScan.resolve('redundant maintenance');
    await scanRelease.promise;
  });
  const delivered = [];
  const loops = new Loops(store, 'project/', async j => {
    delivered.push(j.id);
    started.resolve();
    return delivery.promise;
  });
  await loops.add(job());
  const first = loops.tick();
  await started.promise;
  const ticks = Array.from({ length: 100 }, () => loops.tick());
  const cancelled = loops.cancel('bounded', 'ses_owner');
  let cancellationSettled = false;
  void cancelled.then(() => { cancellationSettled = true; });
  await Promise.resolve();
  assert.equal(cancellationSettled, false, 'active delivery still blocks cancellation');
  blockScans = true;
  delivery.resolve('receipt-1');
  let outcome;
  try {
    outcome = await Promise.race([
      cancelled.then(() => 'cancelled'), redundantScan.promise,
    ]);
  } finally {
    blockScans = false;
    scanRelease.resolve();
    await Promise.all([first, ...ticks, cancelled]);
  }
  assert.equal(outcome, 'cancelled');
  t.mock.timers.tick(10_000);
  await loops.tick();
  assert.deepEqual(delivered, ['bounded']);
  assert.equal((await loops.list())[0].state, 'cancelled');
});

test('coalesced delivery uncertainty pauses without retry and recovery preserves it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = memoryStore();
  const started = deferred();
  const delivery = deferred();
  let deliveries = 0;
  const loops = new Loops(store, 'project/', async () => {
    deliveries++;
    started.resolve();
    return delivery.promise;
  });
  await loops.add(job());
  const first = loops.tick();
  await started.promise;
  const interrupted = await store.get('project/bounded');
  assert.equal(interrupted.state, 'dispatching');
  const ticks = Array.from({ length: 100 }, () => loops.tick());
  delivery.reject(new Error('transport lost after possible admission'));
  await Promise.all([first, ...ticks]);
  t.mock.timers.tick(10_000);
  await loops.tick();
  assert.equal(deliveries, 1);
  const [paused] = await loops.list();
  assert.equal(paused.state, 'paused');
  assert.equal(paused.remaining, 2);
  assert.match(paused.error, /transport lost/);

  const recoveredStore = memoryStore();
  await recoveredStore.set('project/bounded', interrupted);
  const recovered = new Loops(recoveredStore, 'project/', async () => {
    assert.fail('an uncertain dispatch must not be retried');
  });
  await recovered.recover();
  await recovered.tick();
  assert.equal((await recovered.list())[0].state, 'paused');
});

test('a failed maintenance pass releases coalescing so later ticks can run', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const scanStarted = deferred();
  const scanResult = deferred();
  let failScan = false;
  const store = memoryStore(async () => {
    if (!failScan) return;
    scanStarted.resolve();
    await scanResult.promise;
  });
  const delivered = [];
  const loops = new Loops(store, 'project/', async j => {
    delivered.push(j.id);
    return 'receipt';
  });
  await loops.add(job());
  failScan = true;
  const first = loops.tick();
  await scanStarted.promise;
  const second = loops.tick();
  const results = Promise.allSettled([first, second]);
  scanResult.reject(new Error('storage unavailable'));
  assert.deepEqual((await results).map(result => result.status), ['rejected', 'rejected']);
  failScan = false;
  await loops.tick();
  assert.deepEqual(delivered, ['bounded']);
  assert.equal((await loops.list())[0].remaining, 1);
});
