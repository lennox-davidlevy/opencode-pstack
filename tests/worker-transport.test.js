import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { workerTransport } from '../plugins/pstack/worker-transport.js';
import { makeTempDir } from './helpers/temp.js';
import { isolatedOpenCode } from './helpers/isolated-opencode.js';

async function fixture(t) {
  const root = await makeTempDir('pstack-worker-transport-');
  const registrationFile = join(root, 'service.json');
  const password = 'private-test-service-password-' + randomUUID();
  const authorization = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64');
  const calls = [];
  let handler = async (request, response) => { response.end(JSON.stringify({ data: { id: 'ses_fixture' } })); };
  let infoHandler = async (request, response) => { response.end(JSON.stringify({ pid: process.pid, version: 'fixture' })); };
  const server = createServer(async (request, response) => {
    calls.push({ path: request.url, authorization: request.headers.authorization });
    assert.equal(request.headers.authorization, authorization);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/info') return infoHandler(request, response);
    try { await handler(request, response); }
    catch { response.destroy(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const registration = JSON.stringify({ url: endpoint, pid: process.pid, password });
  await writeFile(registrationFile, registration, { mode: 0o600 });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  return { root, registrationFile, registration, endpoint, password, authorization, calls,
    handle(value) { handler = value; },
    handleInfo(value) { infoHandler = value; },
    transport: signal => workerTransport({ registrationFile }, signal) };
}

test('registration endpoints are rejected before any authenticated network request', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  for (const url of [f.endpoint.replace('127.0.0.1', '0.0.0.0'),
    f.endpoint.replace('http://', 'http://user:secret@'), f.endpoint + '/unexpected', f.endpoint + '?secret=value', f.endpoint + '#fragment']) {
    await writeFile(f.registrationFile, JSON.stringify({ url, pid: process.pid, password: f.password }));
    await assert.rejects(f.transport(t.signal));
    assert.deepEqual(f.calls, []);
  }
});

test('the initial health probe refuses redirects without touching their target or exposing credentials', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const calls = [];
  const target = createServer((request, response) => {
    calls.push(request.url);
    response.end(JSON.stringify({ pid: process.pid, version: 'fixture' }));
  });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(async () => { target.closeAllConnections(); await new Promise(resolve => target.close(resolve)); });
  f.handleInfo(async (request, response) => {
    response.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/api/info` });
    response.end(f.password);
  });
  await assert.rejects(f.transport(t.signal), error => {
    assert.ok(!errorText(error).includes(f.password));
    assert.ok(!errorText(error).includes(f.authorization));
    return true;
  });
  assert.deepEqual(calls, []);
});

test('replacement during the initial health probe cannot retarget the returned client', { timeout: 5000 }, async t => {
  const a = await fixture(t);
  const b = await fixture(t);
  a.handleInfo(async (request, response) => {
    await writeFile(a.registrationFile, b.registration);
    response.end(JSON.stringify({ pid: process.pid, version: 'fixture' }));
  });
  const pinned = await a.transport(t.signal);
  await pinned.client.session.get({ sessionID: 'ses_fixture' }, { signal: t.signal });
  assert.deepEqual(b.calls, []);
  assert.equal(pinned.endpoint, a.endpoint);
});

test('registration size, PID and version evidence are bounded before worker access', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  for (const registration of [JSON.stringify({ ...JSON.parse(f.registration), padding: 'x'.repeat(65536) }), JSON.stringify({ url: f.endpoint, password: {}, pid: process.pid })]) {
    await writeFile(f.registrationFile, registration);
    await assert.rejects(f.transport(t.signal));
    assert.deepEqual(f.calls, []);
  }
  for (const changed of [{ pid: process.pid + 1 }, { version: 'different' }]) {
    await writeFile(f.registrationFile, JSON.stringify({ ...JSON.parse(f.registration), ...changed }));
    await assert.rejects(f.transport(t.signal));
  }
  assert.ok(f.calls.every(call => call.path === '/api/info'));
});

test('initial health probe cancellation and failures are sanitized without retrying', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  let entered;
  const dispatched = new Promise(resolve => { entered = resolve; });
  f.handleInfo(async () => { entered(); });
  const controller = new AbortController();
  const pending = assert.rejects(f.transport(controller.signal), /discovery/);
  await dispatched;
  controller.abort(new Error(f.password));
  await pending;
  assert.equal(f.calls.length, 1);
  for (const status of [200, 400, 500]) {
    f.handleInfo(async (request, response) => { response.writeHead(status); response.end(f.password + f.authorization); });
    await assert.rejects(f.transport(t.signal), error => {
      assert.ok(!errorText(error).includes(f.password));
      assert.ok(!errorText(error).includes(f.authorization));
      return true;
    });
  }
  assert.equal(f.calls.length, 4);
});

function errorText(error) {
  return [String(error), ...(error?.cause ? [errorText(error.cause)] : []), ...(error?.errors ?? []).map(errorText)].join('\n');
}

test('native discovery pins one authenticated endpoint despite registration replacement and removal', { timeout: 5000 }, async t => {
  const a = await fixture(t);
  const b = await fixture(t);
  const pinned = await a.transport(t.signal);
  await writeFile(a.registrationFile, b.registration);
  assert.deepEqual(await pinned.client.session.get({ sessionID: 'ses_fixture' }, { signal: t.signal }), { id: 'ses_fixture' });
  await rm(a.registrationFile);
  await pinned.client.server.info({ signal: t.signal });
  await writeFile(a.registrationFile, a.registration);
  await pinned.client.session.get({ sessionID: 'ses_fixture' }, { signal: t.signal });
  assert.equal(b.calls.length, 0);
  assert.equal(a.calls.filter(call => call.path === '/api/session/ses_fixture').length, 2);
  assert.equal(pinned.endpoint, a.endpoint);
  assert.ok(!JSON.stringify(pinned).includes(a.password));
});

test('ambient service registration is discovered once without changing global configuration', { timeout: 5000 }, async t => {
  const a = await fixture(t);
  const b = await fixture(t);
  await mkdir(join(a.root, 'opencode'));
  const file = join(a.root, 'opencode/service.json');
  await writeFile(file, a.registration, { mode: 0o600 });
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = a.root;
  t.after(() => { if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous; });
  const pinned = await workerTransport(undefined, t.signal);
  await writeFile(file, b.registration);
  await pinned.client.session.get({ sessionID: 'ses_fixture' }, { signal: t.signal });
  await writeFile(file, a.registration);
  await pinned.client.server.info({ signal: t.signal });
  assert.equal(b.calls.length, 0);
  assert.equal(pinned.endpoint, a.endpoint);
});

test('pinned SDK requests refuse redirects without touching the redirect target', { timeout: 5000 }, async t => {
  const a = await fixture(t);
  const b = await fixture(t);
  const pinned = await a.transport(t.signal);
  a.handle(async (request, response) => { response.writeHead(307, { location: b.endpoint + request.url }); response.end(); });
  await assert.rejects(pinned.client.session.get({ sessionID: 'ses_fixture' }, { signal: t.signal }));
  assert.equal(b.calls.length, 0);
});

test('missing, malformed and unavailable registrations never start a server or invoke the CLI', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const bin = join(f.root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'opencode'), `#!/bin/sh\nprintf invoked > '${join(f.root, 'unexpected-start')}'\nexit 1\n`, { mode: 0o700 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  t.after(() => { process.env.PATH = previousPath; });
  f.handleInfo(async (_request, response) => { response.writeHead(503); response.end(); });
  for (const value of [undefined, '{', f.registration]) {
    if (value === undefined) await rm(f.registrationFile);
    else await writeFile(f.registrationFile, value);
    await assert.rejects(f.transport(t.signal), /discovery/);
  }
  assert.deepEqual(f.calls, [{ path: '/api/info', authorization: f.authorization }]);
  assert.ok(!(await readdir(f.root)).includes('unexpected-start'));
  assert.equal(await readFile(f.registrationFile, 'utf8'), f.registration);
  await assert.rejects(workerTransport({ registrationFile: 'relative.json' }, t.signal), /Absolute/);
});

test('HTTP failures and malformed responses cannot expose service secrets through error causes', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const pinned = await f.transport(t.signal);
  for (const status of [200, 400, 500]) {
    f.handle(async (request, response) => { response.writeHead(status); response.end(`${f.password} ${f.authorization}`); });
    await assert.rejects(pinned.client.session.get({ sessionID: 'ses_fixture' }, { signal: t.signal }), error => {
      assert.ok(!errorText(error).includes(f.password));
      assert.ok(!errorText(error).includes(f.authorization));
      return true;
    });
  }
  assert.equal(await readFile(f.registrationFile, 'utf8'), f.registration);
  assert.deepEqual((await readdir(f.root)).sort(), ['service.json']);
});

test('SDK cancellation returns before a remotely admitted operation settles', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const pinned = await f.transport(t.signal);
  let dispatched;
  const dispatch = new Promise(resolve => { dispatched = resolve; });
  let settled = false;
  f.handle(async (request, response) => {
    dispatched();
    await delay(120);
    settled = true;
    response.end(JSON.stringify({ interrupted: true }));
  });
  const controller = new AbortController();
  const request = pinned.client.session.interrupt({ sessionID: 'ses_fixture', resume: false }, { signal: controller.signal });
  const rejected = assert.rejects(request);
  await dispatch;
  controller.abort();
  await rejected;
  assert.equal(settled, false);
  await delay(150);
  assert.equal(settled, true);
  assert.equal(f.calls.filter(call => call.path.includes('/interrupt')).length, 1);
});

test('oversized SDK responses fail without retaining a response body in errors', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const pinned = await f.transport(t.signal);
  f.handle(async (request, response) => { response.end('"' + 'x'.repeat(16 * 1024 * 1024) + '"'); });
  await assert.rejects(pinned.client.session.get({ sessionID: 'ses_fixture' }, { signal: t.signal }), error => {
    assert.ok(errorText(error).length < 1000);
    return true;
  });
});

test('test-owned registration is private, discoverable and created only after PID validation', { timeout: 10000 }, async t => {
  for (const validPID of [true, false]) {
    await t.test(validPID ? 'owned PID' : 'wrong PID', async t => {
      const root = await makeTempDir('pstack-owned-registration-');
      const executable = join(root, 'fixture.mjs');
      await writeFile(executable, `#!${process.execPath}
import { createServer } from 'node:http';
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(request.url === '/api/info' ? { pid: process.pid + ${validPID ? 0 : 1}, version: 'fixture' } : { data: [] }));
});
server.listen(0, '127.0.0.1', () => {
  console.log('server password test-owned-only');
  console.log('http://127.0.0.1:' + server.address().port);
});
`, { mode: 0o700 });
      let server;
      t.after(async () => { await server?.stop(); await rm(root, { recursive: true, force: true }); });
      const options = { executable, registerService: true, startupTimeout: 2000, shutdownTimeout: 200 };
      if (!validPID) {
        await assert.rejects(isolatedOpenCode(root, { signal: t.signal }, options), /PID mismatch/);
        assert.ok(!(await readdir(root)).includes('test-service.json'));
        return;
      }
      server = await isolatedOpenCode(root, { signal: t.signal }, options);
      assert.equal((await lstat(server.registrationFile)).mode & 0o777, 0o600);
      const registration = JSON.parse(await readFile(server.registrationFile, 'utf8'));
      assert.equal(registration.pid, server.pid);
      assert.equal(registration.url, server.endpoint);
      const pinned = await workerTransport({ registrationFile: server.registrationFile }, t.signal);
      assert.equal((await pinned.client.server.info({ signal: t.signal })).pid, server.pid);
      assert.ok(!JSON.stringify(pinned).includes(registration.password));
    });
  }
});
