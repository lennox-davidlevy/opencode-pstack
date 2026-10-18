import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkerHistory } from '../plugins/pstack/worker-history.js';
import { makeTempDir } from './helpers/temp.js';

const prefix = 'c02b5ff87bbbc27af031746f/worker/';
const foreignPrefix = '8da73f1424136d2dad17354c/worker/';
const owner = 'ses_owner';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const worker = (number, overrides = {}) => ({ id: id(number), owner, sessionID: `ses_worker${number}`,
  directory: `/tmp/opencode/pstack-worker-${number}/checkout`, ref: 'a'.repeat(40), backend: 'local', ...overrides });

function storage(records, pageSize = 100) {
  const values = new Map(records.map(([scope, record]) => [scope + record.id, record]));
  const reads = [];
  return {
    reads,
    async get(key) { reads.push({ key }); return structuredClone(values.get(key)); },
    async set(key, value) { values.set(key, structuredClone(value)); },
    async scan({ prefix, limit, after }) {
      reads.push({ prefix, limit, after });
      const keys = [...values.keys()].sort().filter(key => key.startsWith(prefix) && (!after || key > after));
      const page = keys.slice(0, Math.min(limit, pageSize));
      return {
        entries: page.map(key => ({ key, value: structuredClone(values.get(key)) })),
        next: keys.length > page.length ? page.at(-1) : undefined,
      };
    },
  };
}

test('worker discovery follows durable storage pages across reloads without losing owned records', async () => {
  const first = worker(3, { backend: 'container', container: 'pstack-worker-3', control: '/tmp/opencode/control-3', role: 'poteto-agent' });
  const second = worker(5);
  const store = storage([
    [prefix, worker(1, { owner: 'ses_other' })], [prefix, worker(2, { owner: 'ses_other' })],
    [prefix, first], [prefix, worker(4, { owner: 'ses_other' })], [prefix, second],
    [foreignPrefix, worker(6)], [prefix + 'nested/', worker(7)],
  ], 2);
  const empty = await new WorkerHistory(store, prefix).list(owner, 3);
  assert.deepEqual(empty.workers, []);
  assert.equal(typeof empty.next, 'string');
  const decoded = Buffer.from(empty.next, 'base64url').toString('utf8');
  assert.ok(!decoded.includes(id(2)), 'cursor must not disclose the foreign worker at the scan boundary');
  const middle = await new WorkerHistory({ ...store }, prefix).list(owner, 3, empty.next);
  assert.deepEqual(middle.workers, [first]);
  assert.equal(typeof middle.next, 'string');
  const last = await new WorkerHistory(store, prefix).list(owner, 3, middle.next);
  assert.deepEqual(last, { workers: [second], next: undefined });
  const scans = store.reads.filter(read => 'prefix' in read);
  assert.equal(scans.length, 3);
  assert.ok(scans.every(read => read.prefix === prefix && read.limit === 3));
});

test('worker listing bounds storage reads and rejects out-of-range page sizes', async () => {
  const records = Array.from({ length: 201 }, (_, index) => [prefix, worker(index + 1)]);
  const store = storage(records);
  const history = new WorkerHistory(store, prefix);
  assert.equal((await history.list(owner)).workers.length, 20);
  const page = await history.list(owner, 100);
  assert.equal(page.workers.length, 100);
  assert.equal(typeof page.next, 'string');
  assert.equal(store.reads.filter(read => 'prefix' in read).length, 2);
  const reads = store.reads.length;
  for (const limit of [0, -1, 101, 1.5, NaN, Infinity, '10', null]) {
    await assert.rejects(history.list(owner, limit));
  }
  assert.equal(store.reads.length, reads);
});

test('worker cursors cannot cross directory or owner scope, including empty filtered pages', async () => {
  const store = storage([[prefix, worker(1, { owner: 'ses_other' })], [prefix, worker(2)], [foreignPrefix, worker(3)]]);
  const history = new WorkerHistory(store, prefix);
  const page = await history.list(owner, 1);
  assert.deepEqual(page.workers, []);
  await assert.rejects(history.list('ses_other', 1, page.next));
  await assert.rejects(new WorkerHistory(store, foreignPrefix).list(owner, 1, page.next));
  for (const cursor of ['', 'not-json', Buffer.from('null').toString('base64url'), 'x'.repeat(16001)]) {
    await assert.rejects(history.list(owner, 1, cursor));
  }
  const forged = Buffer.from(JSON.stringify({ prefix, owner, after: foreignPrefix + id(1) })).toString('base64url');
  await assert.rejects(history.list(owner, 100, forged));
  const bytes = Buffer.from(page.next, 'base64url');
  for (let index = 0; index < bytes.length; index++) {
    const tampered = Buffer.from(bytes);
    tampered[index] ^= 1;
    await assert.rejects(history.list(owner, 1, tampered.toString('base64url')));
  }
  assert.equal(store.reads.filter(read => 'prefix' in read).length, 1);
  assert.deepEqual(await history.list(owner, 1, page.next), { workers: [worker(2)], next: undefined });
});

test('concurrent first listings preserve every cursor after helper and storage handle reload', async () => {
  const store = storage([[prefix, worker(1)], [prefix, worker(2)]]);
  const pages = await Promise.all(Array.from({ length: 10 }, () => new WorkerHistory(store, prefix).list(owner, 1)));
  const { WorkerHistory: ReloadedHistory } = await import('../plugins/pstack/worker-history.js?reload');
  const reloaded = new ReloadedHistory({ ...store }, prefix);
  for (const page of pages) {
    assert.deepEqual(await reloaded.list(owner, 1, page.next), { workers: [worker(2)], next: undefined });
  }
  assert.deepEqual((await store.scan({ prefix, limit: 100 })).entries, [
    { key: prefix + id(1), value: worker(1) },
    { key: prefix + id(2), value: worker(2) },
  ], 'cursor key material must not enter the worker record namespace');
});

test('storage results cannot expose records outside the exact worker key and owner', async () => {
  const own = worker(1);
  const history = new WorkerHistory({
    async get() { return own; },
    async scan() {
      return { entries: [
        { key: prefix + own.id, value: own },
        { key: foreignPrefix + id(2), value: worker(2) },
        { key: prefix + id(3), value: worker(3, { owner: 'ses_other' }) },
        { key: prefix + 'nested/' + id(4), value: worker(4) },
        { key: prefix + id(5), value: worker(6) },
        { key: prefix + id(7), value: null },
      ] };
    },
  }, prefix);
  assert.deepEqual(await history.list(owner), { workers: [own], next: undefined });
  await assert.rejects(history.get(owner, id(2)));
});

test('stopped container and local workers return actual paginated message content and cursors', async () => {
  const records = [worker(1, { backend: 'container', container: 'stopped-container', control: '/unavailable/control' }), worker(2)];
  const history = new WorkerHistory(storage(records.map(record => [prefix, record])), prefix);
  const signal = new AbortController().signal;
  const next = 'opaque+/cursor?limit=100&sessionID=ses_other';
  const receipt = { id: 'msg_tool', type: 'assistant', agent: 'pstack-container',
    model: { providerID: 'test', modelID: 'test' }, time: { created: 1, completed: 2 },
    content: [{ type: 'tool', id: 'call_check', name: 'container_command', time: { created: 1, completed: 2 },
      state: { status: 'completed', input: { command: 'npm test' }, content: [{ type: 'text', text: 'All checks passed' }] } }] };
  const first = { data: [receipt], cursor: { next } };
  const last = { data: [{ id: 'msg_done', type: 'assistant', content: [{ type: 'text', text: 'Done.' }], time: { created: 3 } }], cursor: { previous: 'previous' } };
  for (const record of records) {
    const requests = [];
    const request = async (method, path, body, forwardedSignal) => {
      const url = new URL(path, 'http://localhost');
      assert.equal(method, 'get');
      assert.equal(url.pathname, `/api/session/${record.sessionID}/message`);
      assert.equal(body, undefined);
      assert.equal(forwardedSignal, signal);
      requests.push(url.searchParams);
      return url.searchParams.has('cursor') ? structuredClone(last) : structuredClone(first);
    };
    const page = await history.messages(owner, record.id, undefined, undefined, signal, request);
    assert.deepEqual(page, first);
    assert.deepEqual(await history.messages(owner, record.id, 1, page.cursor.next, signal, request), last);
    assert.deepEqual([...requests[0]], [['limit', '20']]);
    assert.deepEqual([...requests[1]], [['limit', '1'], ['cursor', next]]);
  }
});

test('message reads reject missing, foreign, or malformed workers before requesting history', async () => {
  const store = storage([[prefix, worker(1)], [prefix, worker(2, { owner: 'ses_other' })],
    [foreignPrefix, worker(3)], [prefix, worker(4, { sessionID: 'ses_bad/../../session/ses_other' })]]);
  const history = new WorkerHistory(store, prefix);
  let requests = 0;
  const request = async () => { requests++; return { data: [], cursor: {} }; };
  for (const invalid of [undefined, '', '../worker/' + id(1), id(1) + '?other=true', {}, 1]) {
    await assert.rejects(history.messages(owner, invalid, 20, undefined, undefined, request));
  }
  assert.equal(store.reads.length, 0);
  for (const invalid of [id(2), id(3), id(4), id(99)]) {
    await assert.rejects(history.messages(owner, invalid, 20, undefined, undefined, request));
  }
  for (const limit of [0, 101, 1.5]) {
    await assert.rejects(history.messages(owner, id(1), limit, undefined, undefined, request));
  }
  await assert.rejects(history.messages(owner, id(1), 20, '', undefined, request));
  assert.equal(requests, 0);
  assert.deepEqual(await history.messages(owner, id(1), 20, undefined, undefined, request), { data: [], cursor: {} });
  assert.equal(requests, 1);
});

test('message transport errors propagate without retrying or starting the worker', async () => {
  const history = new WorkerHistory(storage([[prefix, worker(1)]]), prefix);
  const failure = new Error('Session no longer exists');
  let attempts = 0;
  await assert.rejects(history.messages(owner, id(1), 20, undefined, undefined, async () => {
    attempts++;
    throw failure;
  }), error => error === failure);
  assert.equal(attempts, 1);
});

test('ledger-backed history cannot default to or override with the ambient legacy transport', async t => {
  const root = await makeTempDir('pstack-history-transport-');
  await writeFile(join(root, 'opencode'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(join(root, 'unexpected-cli'))}, 'invoked'); process.exitCode = 91;\n`, { mode: 0o700 });
  const previousPath = process.env.PATH;
  process.env.PATH = root;
  t.after(async () => { process.env.PATH = previousPath; await rm(root, { recursive: true, force: true }); });
  const record = worker(1, { server: { endpoint: 'http://127.0.0.1:1234' } });
  const source = {
    async get() { return record; },
    async scan() { return { entries: [] }; },
    async messages(expectedOwner, expectedID, limit, cursor, signal) {
      assert.equal(expectedOwner, owner);
      assert.equal(expectedID, record.id);
      assert.equal(limit, 2);
      assert.equal(cursor, 'cursor');
      assert.equal(signal, controller.signal);
      return { data: [{ text: 'bound history' }], cursor: {} };
    },
  };
  const controller = new AbortController();
  const history = new WorkerHistory(storage([]), prefix, source);
  assert.deepEqual(await history.messages(owner, record.id, 2, 'cursor', controller.signal), { data: [{ text: 'bound history' }], cursor: {} });
  const unbound = new WorkerHistory(storage([]), prefix, { ...source, messages: undefined });
  await assert.rejects(unbound.messages(owner, record.id));
  let requests = 0;
  const request = async () => { requests++; throw new Error('Forbidden ambient transport'); };
  await assert.rejects(history.messages(owner, record.id, 2, 'cursor', controller.signal, request));
  await assert.rejects(new WorkerHistory(storage([[prefix, record]]), prefix).messages(owner, record.id, 2, 'cursor', controller.signal, request));
  assert.equal(requests, 0, 'Rejected calls must not invoke the ambient transport');
  assert.ok(!(await readdir(root)).includes('unexpected-cli'), 'Rejected calls must not invoke the ambient CLI');
});

test('ledger-backed cursors survive unavailable projection reads and writes and keep degraded pages in owner scope', async () => {
  const records = [worker(1),worker(2),worker(3)];
  const key = Buffer.alloc(32,7);
  const source = {
    async get(expected,id) { return records.find(record => record.owner === expected && record.id === id); },
    async cursorKey() { return key; },
    async scan(expected,limit,after,ledgerOnly) {
      assert.ok(after === undefined || ledgerOnly,'Degraded continuation must not silently restore incomplete legacy coverage');
      const entries = records.filter(record => record.owner === expected && (!after || prefix + record.id > after))
        .map(value => ({key:prefix+value.id,value}));
      return {entries:entries.slice(0,limit),next:entries.length>limit ? entries[limit-1].key : undefined,
        ledgerOnly:true,warnings:['ledger-only; incomplete legacy coverage']};
    },
  };
  const unavailable = {async get(){throw new Error('Projection get failed');},async set(){throw new Error('Projection set failed');},async scan(){throw new Error('Projection scan failed');}};
  let page = await new WorkerHistory(unavailable,prefix,source).list(owner,1);
  const found = [];
  while(true) {
    found.push(...page.workers);
    assert.match(page.warnings[0],/incomplete legacy coverage/);
    if(!page.next) break;
    await assert.rejects(new WorkerHistory(unavailable,prefix,source).list('ses_other',1,page.next),/Invalid worker cursor/);
    page = await new WorkerHistory(unavailable,prefix,source).list(owner,1,page.next);
  }
  assert.deepEqual(found,records);
  const corrupt = new Error('Ledger corrupt');
  const first = await new WorkerHistory(unavailable,prefix,source).list(owner,1);
  await assert.rejects(new WorkerHistory(unavailable,prefix,{...source,async cursorKey(){throw corrupt;}}).list(owner,1,first.next),error => error === corrupt);
});
