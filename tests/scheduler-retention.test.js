import test from 'node:test';
import assert from 'node:assert/strict';
import { Loops } from '../plugins/pstack/loops.js';

const prefix = 'project/loop/';
const job = (id, state = 'done') => ({ id, sessionID: 'ses_owner', directory: '/project',
  prompt: 'Check one predicate', intervalMs: 1000, remaining: 2,
  nextAt: 100, expiresAt: 60_000, state });

function memoryStore({ pageSize = 100, finalCursor = false } = {}) {
  const data = new Map();
  const calls = { scans: [], writes: 0, deletes: 0, recordsRead: 0, gets: 0 };
  return {
    calls,
    async get(key) { calls.gets++; return structuredClone(data.get(key)); },
    async set(key, value) { calls.writes++; data.set(key, structuredClone(value)); },
    async delete(key) { calls.deletes++; data.delete(key); },
    async scan({ prefix, limit, after }) {
      calls.scans.push({ prefix, limit, after });
      const keys = [...data.keys()].filter(key => key.startsWith(prefix) && (!after || key > after)).sort();
      const selected = keys.slice(0, Math.min(pageSize, limit));
      calls.recordsRead += selected.length;
      return { entries: selected.map(key => ({ key, value: structuredClone(data.get(key)) })),
        next: selected.length && (keys.length > selected.length || finalCursor) ? selected.at(-1) : undefined };
    },
    async snapshot() { return structuredClone([...data]); },
  };
}

async function seed(store, count, namespace = prefix) {
  for (let i = 0; i < count; i++) {
    const record = job(String(i).padStart(4, '0'), ['done', 'cancelled', 'paused'][i % 3]);
    record.sessionID = i % 2 ? 'ses_other' : 'ses_owner';
    await store.set(namespace + record.id, record);
  }
}

const noDelivery = async () => { assert.fail('no schedule should be delivered'); };

function sizedRecord(record, bytes = 65536) {
  const result = { ...record, prompt: '' };
  const room = bytes - Buffer.byteLength(JSON.stringify(result));
  result.prompt = '\0'.repeat(Math.floor(room / 6)) + 'a'.repeat(room % 6);
  assert.equal(Buffer.byteLength(JSON.stringify(result)), bytes);
  return result;
}

test('100 retained terminal schedules remain listable and reject additions without deleting history', async () => {
  const store = memoryStore();
  const loops = new Loops(store, prefix, noDelivery);
  for (let i = 0; i < 100; i++) await loops.add(job(String(i).padStart(4, '0')));
  const before = await store.snapshot();
  const writes = store.calls.writes;
  assert.equal((await loops.list()).length, 100);
  await assert.rejects(loops.add(job('extra', 'armed')), /100 retained schedules.*Operator-approved retention management/);
  await loops.tick();
  assert.deepEqual(await store.snapshot(), before);
  assert.equal(store.calls.writes, writes);
  assert.equal(store.calls.deletes, 0);
});

test('exactly 100 records can finish with an empty final page without being treated as overflow', async () => {
  const store = memoryStore({ pageSize: 1, finalCursor: true });
  await seed(store, 100);
  const loops = new Loops(store, prefix, noDelivery);
  assert.equal((await loops.list()).length, 100);
  assert.equal(store.calls.recordsRead, 100);
  assert.ok(store.calls.scans.length <= 101);
  assert.ok(store.calls.scans.every(call => call.limit <= 100));
});

test('legacy overflow fails list, admission, recovery and tick after at most 101 records', async () => {
  const store = memoryStore();
  await seed(store, 1000);
  const before = await store.snapshot();
  const loops = new Loops(store, prefix, noDelivery);
  for (const operation of [() => loops.list(), () => loops.add(job('extra', 'armed')),
    () => loops.recover(), () => loops.tick()]) {
    const scans = store.calls.scans.length;
    const read = store.calls.recordsRead;
    await assert.rejects(operation(), /exceeds 100 retained records.*Operator-approved retention management/);
    assert.ok(store.calls.scans.length - scans <= 2);
    assert.ok(store.calls.recordsRead - read <= 101);
    assert.ok(store.calls.scans.slice(scans).every(call => call.limit <= 100));
  }
  assert.deepEqual(await store.snapshot(), before);
  assert.equal(store.calls.deletes, 0);
  await assert.rejects(loops.cancel('0001', 'ses_owner'), /not owned/);
  await loops.cancel('0000', 'ses_owner');
  assert.equal((await store.get(prefix + '0000')).state, 'cancelled');
});

test('retention counts only the project namespace and preserves the separate 20 armed limit', async () => {
  const store = memoryStore();
  await seed(store, 120, 'another-project/loop/');
  const loops = new Loops(store, prefix, noDelivery);
  for (let i = 0; i < 20; i++) await loops.add(job(`active-${i}`, 'armed'));
  await assert.rejects(loops.add(job('excess-active', 'armed')), /20 active schedules/);
  assert.equal((await loops.list()).length, 20);
  await loops.cancel('active-0', 'ses_owner');
  await loops.add(job('replacement', 'armed'));
  assert.equal((await loops.list()).length, 21);
  assert.equal(store.calls.deletes, 0);
});

test('one-record legacy pages stop on the 101st record rather than scanning the remaining history', async () => {
  const store = memoryStore({ pageSize: 1 });
  await seed(store, 1000);
  const loops = new Loops(store, prefix, noDelivery);
  await assert.rejects(loops.list(), /exceeds 100 retained records/);
  assert.equal(store.calls.scans.length, 101);
  assert.equal(store.calls.recordsRead, 101);
});

test('active schedules deliver without catch-up and cancel below the retention limit', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = memoryStore({ pageSize: 7 });
  await seed(store, 98);
  const delivered = [];
  const loops = new Loops(store, prefix, async record => {
    delivered.push(record.id);
    return 'receipt';
  });
  await loops.add(job('active', 'armed'));
  await loops.add(job('cancel-me', 'armed'));
  await assert.rejects(loops.cancel('cancel-me', 'ses_other'), /not owned/);
  await loops.cancel('cancel-me', 'ses_owner');
  await loops.tick();
  assert.deepEqual(delivered, ['active']);
  t.mock.timers.tick(10_000);
  await loops.tick();
  await loops.tick();
  assert.deepEqual(delivered, ['active', 'active']);
  const listed = await loops.list();
  assert.equal(listed.length, 100);
  assert.equal(listed.find(record => record.id === 'active').state, 'done');
  assert.equal(listed.find(record => record.id === 'cancel-me').state, 'cancelled');
  assert.equal(store.calls.deletes, 0);
});

test('repeated and cycling cursors fail boundedly rather than returning incomplete history', async () => {
  for (const cursors of [['same', 'same'], ['first', 'second', 'first']]) {
    let scans = 0;
    const store = { async scan() { return { entries: [], next: cursors[scans++ % cursors.length] }; } };
    const loops = new Loops(store, prefix, noDelivery);
    await assert.rejects(loops.list(), /nonadvancing scan cursor/);
    assert.ok(scans <= 3);
  }
});

test('endless advancing empty pages stop at an explicit scan budget', async () => {
  let scans = 0;
  const store = { async scan() { return { entries: [], next: `cursor-${++scans}` }; } };
  const loops = new Loops(store, prefix, noDelivery);
  await assert.rejects(loops.list(), /exceeded 101 pages.*Operator-approved retention management/);
  assert.equal(scans, 101);
});

test('storage pages that violate the requested limit are rejected without inspecting their records', async () => {
  let scans = 0;
  const entries = Array.from({ length: 101 }, () => ({
    get value() { assert.fail('an oversized page must not be processed'); },
  }));
  const store = { async scan({ limit }) { scans++; assert.ok(limit <= 100); return { entries }; } };
  const loops = new Loops(store, prefix, noDelivery);
  await assert.rejects(loops.list(), /oversized scan page/);
  assert.equal(scans, 1);
});

test('new admission reserves lifecycle room while legacy reads preserve the 65536-byte boundary', async () => {
  const store = memoryStore();
  const loops = new Loops(store, prefix, noDelivery);
  const exact = sizedRecord(job('exact'));
  await assert.rejects(loops.add(exact), /lifecycle/);
  await store.set(prefix + exact.id, exact);
  assert.deepEqual(await loops.list(), [exact]);
  const oversized = { ...exact, id: 'large', prompt: exact.prompt + 'a' };
  const multibyte = { ...exact, prompt: 'é'.repeat(32768) };
  for (const record of [oversized, multibyte, { ...job('nested'), extra: { history: [] } }]) {
    const before = await store.snapshot();
    await assert.rejects(loops.add(record), /Invalid or oversized schedule record.*65536 JSON bytes/);
    assert.deepEqual(await store.snapshot(), before);
    const legacy = memoryStore();
    await legacy.set(prefix + record.id, record);
    const beforeRead = await legacy.snapshot();
    await assert.rejects(new Loops(legacy, prefix, noDelivery).list(), /Invalid or oversized schedule record/);
    assert.deepEqual(await legacy.snapshot(), beforeRead);
  }
});

test('new schedules bound identity and prompt and leave room for cancellation and receipts', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = memoryStore();
  const loops = new Loops(store, prefix, async () => 'receipt-'.repeat(100));
  for (const record of [
    { ...job('x'), id: 'x'.repeat(201) },
    { ...job('x'), sessionID: 'x'.repeat(201) },
    { ...job('x'), directory: 'x'.repeat(4097) },
    { ...job('x'), prompt: 'x'.repeat(16001) },
  ]) await assert.rejects(loops.add(record), /identity|prompt/);
  await assert.rejects(loops.add(sizedRecord(job('over-admission', 'armed'), 61441)), /reserve.*lifecycle/);
  assert.deepEqual(await store.snapshot(), []);
  const admitted = sizedRecord(job('bounded', 'armed'), 61440);
  await loops.add(admitted);
  await loops.tick();
  const delivered = await store.get(prefix + admitted.id);
  assert.equal(delivered.receipt, 'receipt-'.repeat(100));
  assert.equal(delivered.remaining, 1);
  await loops.cancel(admitted.id, admitted.sessionID);
  assert.equal((await store.get(prefix + admitted.id)).state, 'cancelled');
  assert.ok((await store.snapshot()).every(([, value]) => Buffer.byteLength(JSON.stringify(value)) <= 65536));
});

test('cancelling an exact-size legacy record rejects without altering its receipt or history', async () => {
  const store = memoryStore();
  const original = sizedRecord({ ...job('legacy'), receipt: 'original-receipt' });
  await store.set(prefix + original.id, original);
  const loops = new Loops(store, prefix, noDelivery);
  await assert.rejects(loops.cancel(original.id, 'ses_other'), /not owned/);
  await assert.rejects(loops.cancel(original.id, original.sessionID), /Invalid or oversized schedule record/);
  assert.deepEqual(await store.get(prefix + original.id), original);
  assert.equal(store.calls.writes, 1);
});

test('cancellation fits exactly and recovery preserves existing evidence near the record limit', async () => {
  const store = memoryStore();
  const cancelled = sizedRecord({ ...job('cancel', 'cancelled'), receipt: 'original-receipt' });
  const beforeCancel = { ...cancelled, state: 'done' };
  await store.set(prefix + beforeCancel.id, beforeCancel);
  const beforeRecover = sizedRecord({ ...job('recover', 'dispatching'), receipt: 'previous-receipt', error: 'original-error' });
  await store.set(prefix + beforeRecover.id, beforeRecover);
  const loops = new Loops(store, prefix, noDelivery);
  await loops.cancel(beforeCancel.id, beforeCancel.sessionID);
  await loops.recover();
  assert.deepEqual(await store.get(prefix + beforeCancel.id), cancelled);
  assert.deepEqual(await store.get(prefix + beforeRecover.id), { ...beforeRecover, state: 'paused' });
  assert.ok((await store.snapshot()).every(([, value]) => Buffer.byteLength(JSON.stringify(value)) <= 65536));
});

test('recovery overflow preserves the original durable dispatch and receipt without replay', async () => {
  const store = memoryStore();
  const original = sizedRecord({ ...job('legacy', 'dispatching'), receipt: 'previous-receipt' });
  await store.set(prefix + original.id, original);
  const loops = new Loops(store, prefix, noDelivery);
  await assert.rejects(loops.recover(), /Invalid or oversized schedule record/);
  const scans = store.calls.scans.length;
  await assert.rejects(loops.tick(), /quarantined/);
  assert.equal(store.calls.scans.length, scans);
  assert.deepEqual(await store.get(prefix + original.id), original);
  assert.equal(store.calls.writes, 1);
});

for (const outcome of ['receipt', 'error']) {
  test(`oversized delivery ${outcome} leaves dispatch durable without truncating prior receipt`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 100 });
    const store = memoryStore();
    const original = { ...job('legacy', 'armed'), receipt: 'previous-receipt' };
    await store.set(prefix + original.id, original);
    let deliveries = 0;
    const loops = new Loops(store, prefix, async () => {
      deliveries++;
      if (outcome === 'error') throw new Error('x'.repeat(65536));
      return 'x'.repeat(65536);
    });
    await assert.rejects(loops.tick(), /Invalid or oversized schedule record/);
    const durable = await store.get(prefix + original.id);
    assert.deepEqual(durable, { ...original, state: 'dispatching' });
    const scans = store.calls.scans.length;
    await assert.rejects(loops.tick(), /quarantined/);
    assert.equal(store.calls.scans.length, scans);
    assert.equal(deliveries, 1);
    assert.equal(store.calls.writes, 2);
    const reloaded = new Loops(store, prefix, noDelivery);
    await reloaded.recover();
    await reloaded.tick();
    assert.equal((await store.get(prefix + original.id)).state, 'paused');
    assert.equal((await store.get(prefix + original.id)).receipt, 'previous-receipt');
  });
}

test('a small new receipt that overflows a legacy record cannot rearm it or discard the prior receipt', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = memoryStore();
  const original = sizedRecord({ ...job('legacy', 'armed'), receipt: 'previous-receipt' }, 65530);
  await store.set(prefix + original.id, original);
  let deliveries = 0;
  const loops = new Loops(store, prefix, async () => { deliveries++; return 'r'.repeat(100); });
  await assert.rejects(loops.tick(), /Invalid or oversized schedule record/);
  assert.deepEqual(await store.get(prefix + original.id), { ...original, state: 'dispatching' });
  assert.equal(Buffer.byteLength(JSON.stringify(await store.get(prefix + original.id))), 65536);
  await assert.rejects(loops.tick(), /quarantined/);
  assert.equal(deliveries, 1);
  assert.equal(store.calls.writes, 2);
});

test('dispatch-state overflow prevents delivery and preserves the exact-size armed original', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = memoryStore();
  const original = sizedRecord({ ...job('legacy', 'armed'), receipt: 'previous-receipt' });
  await store.set(prefix + original.id, original);
  const loops = new Loops(store, prefix, noDelivery);
  await assert.rejects(loops.tick(), /Invalid or oversized schedule record/);
  await assert.rejects(loops.tick(), /quarantined/);
  assert.deepEqual(await store.get(prefix + original.id), original);
  assert.equal(store.calls.writes, 1);
});

test('malformed persisted numeric semantics block recovery and delivery without mutation', async () => {
  const malformed = [
    ...[0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1].map(intervalMs => ({ intervalMs })),
    ...[-1, 0.5, 101, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1].map(remaining => ({ remaining })),
    ...['nextAt', 'expiresAt'].flatMap(key => [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]
      .map(value => ({ [key]: value }))),
    ...[0, -1, 0.5, 101, Infinity, NaN, '1'].map(receiptSlot => ({ receipt: 'previous', receiptSlot })),
    { receiptSlot: 1 },
  ];
  for (const change of malformed) {
    for (const operation of ['recover', 'tick']) {
      const store = memoryStore();
      const original = { ...job('malformed', 'armed'), ...change };
      await store.set(prefix + original.id, original);
      const loops = new Loops(store, prefix, noDelivery);
      await assert.rejects(loops[operation](), /Invalid or oversized schedule record/);
      const scans = store.calls.scans.length;
      await assert.rejects(loops.tick(), /quarantined/);
      assert.equal(store.calls.scans.length, scans);
      assert.deepEqual(await store.get(prefix + original.id), original);
      assert.equal(store.calls.writes, 1);
    }
  }
});

test('valid internal millisecond fixtures, terminal remaining runs and receipt-free pauses are preserved', async () => {
  const store = memoryStore();
  const records = [job('expired', 'done'), job('paused', 'paused'),
    { ...job('short', 'cancelled'), intervalMs: 10, remaining: 100, nextAt: 0, expiresAt: 100 },
    { ...job('safe', 'done'), intervalMs: Number.MAX_SAFE_INTEGER, nextAt: Number.MAX_SAFE_INTEGER,
      expiresAt: Number.MAX_SAFE_INTEGER }];
  for (const record of records) await store.set(prefix + record.id, record);
  const before = await store.snapshot();
  const loops = new Loops(store, prefix, noDelivery);
  await loops.recover();
  await loops.tick();
  assert.equal((await loops.list()).length, 4);
  assert.deepEqual(await store.snapshot(), before);
});

test('persisted identity mismatch never delivers or overwrites a different schedule during cancellation', async () => {
  const store = memoryStore();
  await store.set(prefix + 'requested', job('different', 'armed'));
  const before = await store.snapshot();
  const loops = new Loops(store, prefix, noDelivery);
  await assert.rejects(loops.tick(), /identity does not match/);
  await assert.rejects(loops.cancel('requested', 'ses_owner'), /identity does not match/);
  assert.deepEqual(await store.snapshot(), before);
  assert.equal(store.calls.writes, 1);
});

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

test('recovery remains paused when a pre-retirement completion write later restores an armed snapshot', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = memoryStore();
  const held = deferred();
  const writing = deferred();
  const set = store.set.bind(store);
  let block = true;
  store.set = async (key, value) => {
    if (block && key === prefix + 'late' && value.receipt) { writing.resolve(); await held.promise; }
    await set(key, value);
  };
  const old = new Loops(store, prefix, async () => 'late-receipt');
  await old.add(job('late', 'armed'));
  const pending = old.tick();
  t.after(async () => { held.resolve(); await pending; });
  await writing.promise;
  old.retire();
  const replacement = new Loops(store, prefix, noDelivery);
  await replacement.recover();
  block = false;
  held.resolve();
  await pending;
  assert.equal((await store.get(prefix + 'late')).state, 'armed', 'the pending SDK write actually settled');
  t.mock.timers.tick(10_000);
  await replacement.tick();
  const [paused] = await replacement.list();
  assert.equal(paused.state, 'paused');
  assert.equal(paused.receipt, 'late-receipt');
  const reloaded = new Loops(store, prefix, noDelivery);
  await reloaded.recover();
  await reloaded.tick();
  assert.equal((await reloaded.list())[0].state, 'paused');
  assert.equal(store.calls.deletes, 0);
});

test('out-of-order retired receipts remain separate and the latest dispatch receipt is listed', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = memoryStore();
  const set = store.set.bind(store);
  const holds = [deferred(), deferred()];
  const written = [deferred(), deferred()];
  store.set = async (key, value) => {
    await set(key, value);
    if (key !== prefix + 'late' || !value.receipt || value.state !== 'armed') return;
    const index = value.receipt === 'first-receipt' ? 0 : 1;
    written[index].resolve();
    await holds[index].promise;
  };
  const first = new Loops(store, prefix, async () => 'first-receipt');
  await first.add({ ...job('late', 'armed'), remaining: 3 });
  const firstTick = first.tick();
  let secondTick = Promise.resolve();
  t.after(async () => { for (const hold of holds) hold.resolve(); await Promise.all([firstTick, secondTick]); });
  await written[0].promise;
  first.retire();
  const second = new Loops(store, prefix, async () => 'second-receipt');
  await second.recover();
  t.mock.timers.tick(1000);
  secondTick = second.tick();
  await written[1].promise;
  second.retire();
  const replacement = new Loops(store, prefix, noDelivery);
  await replacement.recover();
  await replacement.cancel('late', 'ses_owner');
  holds[1].resolve();
  await secondTick;
  holds[0].resolve();
  await firstTick;
  const gets = store.calls.gets;
  const [cancelled] = await replacement.list();
  assert.ok(store.calls.gets - gets <= 102, 'evidence reads have a fixed per-schedule budget');
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.receipt, 'second-receipt');
  const evidence = (await store.snapshot()).filter(([key, value]) => !key.startsWith(prefix) && value.receipt);
  assert.deepEqual(evidence.map(([, value]) => value.receipt).sort(), ['first-receipt', 'second-receipt']);
  t.mock.timers.tick(10_000);
  await replacement.tick();
  assert.deepEqual((await store.snapshot()).filter(([key, value]) => !key.startsWith(prefix) && value.receipt), evidence);
  assert.equal(store.calls.deletes, 0);
});

test('an older retired completion cannot replace a normally completed replacement receipt after cancellation', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 100 });
  const store = memoryStore();
  const set = store.set.bind(store);
  const committed = deferred();
  const held = deferred();
  store.set = async (key, value) => {
    await set(key, value);
    if (key === prefix + 'mixed' && value.receipt === 'receipt-A' && value.state === 'armed') {
      committed.resolve();
      await held.promise;
    }
  };
  const old = new Loops(store, prefix, async () => 'receipt-A');
  await old.add({ ...job('mixed', 'armed'), remaining: 3 });
  const pending = old.tick();
  t.after(async () => { held.resolve(); await pending; });
  await committed.promise;
  old.retire();
  const replacement = new Loops(store, prefix, async () => 'receipt-B');
  await replacement.recover();
  t.mock.timers.tick(1000);
  await replacement.tick();
  assert.equal((await store.get(prefix + 'mixed')).receipt, 'receipt-B');
  await replacement.cancel('mixed', 'ses_owner');
  held.resolve();
  await pending;
  for (const reader of [replacement, new Loops(store, prefix, noDelivery)]) {
    await reader.recover();
    await reader.tick();
    const [cancelled] = await reader.list();
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.receipt, 'receipt-B');
    assert.equal(cancelled.remaining, 1);
  }
  const records = await store.snapshot();
  assert.equal(records.find(([key]) => key === prefix + 'mixed')[1].receipt, 'receipt-B');
  assert.ok(records.some(([key, value]) => !key.startsWith(prefix) && value.receipt === 'receipt-A'));
  assert.equal(store.calls.deletes, 0);
});

test('retained schedule IDs cannot be reused to bypass permanent cancellation', async () => {
  const store = memoryStore();
  const loops = new Loops(store, prefix, noDelivery);
  await loops.add(job('same'));
  await loops.cancel('same', 'ses_owner');
  const before = await store.snapshot();
  await assert.rejects(loops.add(job('same', 'armed')), /already retained/);
  assert.deepEqual(await store.snapshot(), before);
});

test('legacy receipts keep unknown provenance while proven later outcomes and inherited receipts are ordered safely', async () => {
  const cases = [
    { name: 'legacy-newer', snapshot: { remaining: 1, receipt: 'current' },
      outcomes: [{ slot: 3, receipt: 'older' }], receipt: 'current', receiptSlot: undefined },
    { name: 'legacy-equal', snapshot: { remaining: 1, receipt: 'current' },
      outcomes: [{ slot: 2, receipt: 'current' }], receipt: 'current', receiptSlot: undefined },
    { name: 'legacy-older', snapshot: { remaining: 3, receipt: 'older' },
      outcomes: [{ slot: 3, receipt: 'current' }], receipt: 'current', receiptSlot: 3 },
    { name: 'unknown-inherited', snapshot: { remaining: 1, receipt: 'current', receiptSlot: 2 },
      outcomes: [{ slot: 1, receipt: 'older', error: 'uncertain' }], receipt: 'current', receiptSlot: 2 },
    { name: 'known-inherited', snapshot: { remaining: 1, receipt: 'current', receiptSlot: 2 },
      outcomes: [{ slot: 1, receipt: 'older', receiptSlot: 3, error: 'uncertain' }], receipt: 'current', receiptSlot: 2 },
    { name: 'missing-snapshot-receipt', snapshot: { remaining: 1 },
      outcomes: [{ slot: 100, receipt: 'inherited', error: 'uncertain' }, { slot: 99, receipt: 'proven' }],
      receipt: 'proven', receiptSlot: 99 },
  ];
  for (const fixture of cases) {
    const store = memoryStore();
    const loops = new Loops(store, prefix, noDelivery);
    const record = { ...job(fixture.name), ...fixture.snapshot };
    await store.set(prefix + record.id, record);
    await loops.cancel(record.id, record.sessionID);
    for (const { slot, ...evidence } of fixture.outcomes) {
      await loops.recordOutcome({ ...job(record.id), ...evidence,
        remaining: evidence.error ? slot : slot - 1,
        state: evidence.error ? 'paused' : slot === 1 ? 'done' : 'armed' }, slot);
    }
    const [listed] = await loops.list();
    assert.equal(listed.state, 'cancelled', fixture.name);
    assert.equal(listed.receipt, fixture.receipt, fixture.name);
    assert.equal(listed.receiptSlot, fixture.receiptSlot, fixture.name);
    assert.equal(listed.remaining, record.remaining, fixture.name);
  }
});

test('100 cancelled jobs retain all 100 outcomes each with bounded reads and no pruning', { timeout: 5000 }, async () => {
  const store = memoryStore({ pageSize: 7 });
  const loops = new Loops(store, prefix, noDelivery);
  for (let index = 0; index < 100; index++) {
    const record = { ...job(String(index).padStart(4, '0')), remaining: 0,
      receipt: `newest-${index}`, receiptSlot: 1 };
    await store.set(prefix + record.id, record);
    await loops.cancel(record.id, record.sessionID);
    for (let slot = 1; slot <= 100; slot++) await loops.recordOutcome({ ...record,
      receipt: slot === 1 ? record.receipt : `older-${index}-${slot}`, receiptSlot: slot,
      remaining: slot - 1, state: slot === 1 ? 'done' : 'armed' }, slot);
  }
  const before = await store.snapshot();
  assert.equal(before.length, 10_200);
  const gets = store.calls.gets;
  const scans = store.calls.scans.length;
  const listed = await loops.list();
  assert.equal(listed.length, 100);
  assert.ok(listed.every((record, index) => record.state === 'cancelled' && record.receipt === `newest-${index}`));
  assert.ok(store.calls.gets - gets <= 10_200);
  assert.ok(store.calls.scans.length - scans <= 101);
  await loops.recover();
  await loops.tick();
  await assert.rejects(loops.add(job('extra')), /100 retained schedules/);
  assert.deepEqual(await store.snapshot(), before);
  assert.equal(store.calls.deletes, 0);
});

for (const invalid of ['control', 'outcome', 'provenance']) {
  test(`invalid retained ${invalid} quarantines scheduling without blocking cancellation by ID`, { timeout: 5000 }, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 100 });
    const store = memoryStore();
    const started = deferred();
    const delivery = deferred();
    const old = new Loops(store, prefix, async () => { started.resolve(); return delivery.promise; });
    await old.add(job('late', 'armed'));
    const pending = old.tick();
    t.after(async () => { delivery.resolve('late-receipt'); await pending; });
    await started.promise;
    old.retire();
    const replacement = new Loops(store, prefix, noDelivery);
    await replacement.recover();
    await replacement.cancel('late', 'ses_owner');
    delivery.resolve('late-receipt');
    await pending;
    const [key, value] = (await store.snapshot()).find(([key, value]) => !key.startsWith(prefix)
      && (invalid === 'control' ? !value.state : value.receipt === 'late-receipt'));
    await store.set(key, invalid === 'control' ? { ...value, sessionID: 'ses_other' }
      : invalid === 'outcome' ? { ...value, remaining: 101 } : { ...value, receiptSlot: 1 });
    const reloaded = new Loops(store, prefix, noDelivery);
    await assert.rejects(reloaded.recover(), /quarantined/);
    const scans = store.calls.scans.length;
    await assert.rejects(reloaded.tick(), /quarantined/);
    assert.equal(store.calls.scans.length, scans);
    await assert.rejects(reloaded.cancel('late', 'ses_other'), /not owned/);
    assert.equal((await reloaded.cancel('late', 'ses_owner')).state, 'cancelled');
    assert.equal(store.calls.deletes, 0);
  });
}
