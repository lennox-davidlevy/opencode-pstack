import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { makeTempDir } from './helpers/temp.js';
import { isolatedOpenCode } from './helpers/isolated-opencode.js';

async function fixture(mode = 'ready') {
  const root = await makeTempDir('pstack-isolation-regression-');
  const executable = join(root, 'server.mjs');
  await writeFile(executable, `#!${process.execPath}
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync, appendFileSync } from 'node:fs';
const mode = ${JSON.stringify(mode)};
const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.send('ready');"],
  { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
await once(descendant, 'message');
descendant.disconnect();
writeFileSync('pids.json', JSON.stringify([process.pid, descendant.pid]));
if (mode === 'early-exit') process.exit(17);
if (mode === 'silent') await new Promise(() => {});
const server = http.createServer((request, response) => {
  appendFileSync('requests.log', request.url + '\\n');
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/hang') return;
  if (request.url === '/api/error') {
    response.writeHead(500);
    response.end(JSON.stringify({ _tag: 'RpcInternalError', type: 'rpc.internal' }));
    return;
  }
  const body = request.url === '/api/info' ? { pid: process.pid + (mode === 'wrong-pid' ? 1 : 0) } :
    request.url === '/api/environment' ? process.env : { data: [] };
  response.end(JSON.stringify(body));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
if (mode === 'noisy') process.stdout.write('x'.repeat(300000) + '\\n');
console.log('server password fixture-secret');
console.log('http://127.0.0.1:' + server.address().port);
`, { mode: 0o700 });
  return { root, options: { executable, startupTimeout: 3000, requestTimeout: 2000, shutdownTimeout: 200 } };
}

async function assertStopped(root) {
  const pids = JSON.parse(await readFile(join(root, 'pids.json'), 'utf8'));
  for (const pid of pids) {
    let stopped = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
        if (/^[ZX] /.test(stat.slice(stat.lastIndexOf(')') + 2))) { stopped = true; break; }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        stopped = true;
        break;
      }
      await delay(20);
    }
    assert.ok(stopped, `Owned process ${pid} must no longer run`);
  }
}

const linux = { skip: process.platform !== 'linux', timeout: 15000 };

test('owned server receives only isolated environment and retains bounded redacted output', linux, async t => {
  const { root, options } = await fixture('noisy');
  const previous = process.env;
  process.env = { ...previous, OPENAI_API_KEY: 'not-a-real-key', OPENCODE_SERVER_PASSWORD: 'not-the-owned-password',
    NODE_OPTIONS: '--invalid-inherited-option', HTTPS_PROXY: 'http://127.0.0.1:1', DOCKER_HOST: 'invalid-inherited-host' };
  let server;
  try { server = await isolatedOpenCode(root, t, options); }
  finally { process.env = previous; }
  assert.deepEqual(await server.api('GET', '/api/environment'), server.env);
  assert.equal((await server.api('GET', '/api/info')).pid, server.pid);
  await assert.rejects(server.api('GET', '/api/error'), error => {
    assert.equal(error.status, 500);
    assert.deepEqual(JSON.parse(error.body), { _tag: 'RpcInternalError', type: 'rpc.internal' });
    assert.equal(error.stdout, undefined);
    return true;
  });
  await server.stop();
  await server.stop();
  await assertStopped(root);
  const log = await readFile(join(root, 'server.log'), 'utf8');
  assert.ok(log.length <= 256 * 1024 + 64);
  assert.match(log, /earlier output truncated/);
  assert.doesNotMatch(log, /fixture-secret/);
  await assert.rejects(server.api('GET', '/api/info'), /not running/);
  await rm(root, { recursive: true, force: true });
});

for (const [mode, expected] of [
  ['wrong-pid', /PID mismatch/],
  ['silent', /did not announce/],
  ['early-exit', /exited before readiness/],
]) {
  test(`startup failure ${mode} stops the owned group without exposing an API`, linux, async t => {
    const { root, options } = await fixture(mode);
    await assert.rejects(isolatedOpenCode(root, t, options), expected);
    await assertStopped(root);
    if (mode === 'wrong-pid') assert.equal(await readFile(join(root, 'requests.log'), 'utf8'), '/api/info\n');
    await rm(root, { recursive: true, force: true });
  });
}

test('registered cleanup stops descendants and cancels a pending request after an assertion fails', linux, async t => {
  const { root, options } = await fixture();
  const cleanups = [];
  const scope = { signal: t.signal, after: cleanup => { cleanups.push(cleanup); t.after(cleanup); } };
  const server = await isolatedOpenCode(root, scope, options);
  const pending = server.api('GET', '/api/hang');
  pending.catch(() => {});
  for (let attempt = 0; ; attempt++) {
    if ((await readFile(join(root, 'requests.log'), 'utf8')).includes('/api/hang')) break;
    assert.ok(attempt < 100, 'The request must reach the fixture before cleanup');
    await delay(10);
  }
  await assert.rejects(async () => {
    try { assert.fail('synthetic assertion failure'); }
    finally { for (const cleanup of cleanups) await cleanup(); }
  }, /synthetic assertion failure/);
  await assert.rejects(pending, /Isolated server stopped/);
  await assertStopped(root);
  await rm(root, { recursive: true, force: true });
});

test('caller, owner, and deadline cancellation settle pending HTTP reads', linux, async t => {
  const { root, options } = await fixture();
  const owner = new AbortController();
  const server = await isolatedOpenCode(root, { signal: AbortSignal.any([t.signal, owner.signal]) }, options);
  t.after(server.stop);
  const caller = new AbortController();
  const pending = server.api('GET', '/api/hang', undefined, caller.signal);
  caller.abort(new Error('caller cancelled'));
  await assert.rejects(pending, /caller cancelled/);
  await assert.rejects(server.api('GET', '/api/hang'), { name: 'TimeoutError' });
  const ownedRequest = server.api('GET', '/api/hang');
  owner.abort(new Error('owner cancelled'));
  await assert.rejects(ownedRequest, /owner cancelled/);
  await server.stop();
  await assertStopped(root);
  await rm(root, { recursive: true, force: true });
});

test('installed server ignores synthetic ambient MCP configuration and credentials',
  { skip: process.env.PSTACK_PORTABILITY_TEST !== '1', timeout: 60000 }, async t => {
    const fixture = await makeTempDir('pstack-ambient-isolation-');
    const root = join(fixture, 'owned');
    const home = join(fixture, 'ambient');
    const config = join(home, '.config');
    const marker = join(fixture, 'ambient-mcp-started');
    await mkdir(root);
    await mkdir(join(config, 'opencode'), { recursive: true });
    const ambient = { mcp: { servers: { 'isolation-canary': { type: 'local', command: [process.execPath,
      '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`] } } } };
    const configuration = join(config, 'opencode/opencode.json');
    await writeFile(configuration, JSON.stringify(ambient));
    const directory = join(root, 'project');
    await mkdir(directory);
    await writeFile(join(directory, 'opencode.json'), JSON.stringify({ agents: {
      'isolated-fixture': { mode: 'primary', permissions: [] },
    } }));
    let server;
    t.after(async () => {
      if (!server) return;
      await server.stop();
      await rm(fixture, { recursive: true, force: true });
    });
    const previous = process.env;
    process.env = { ...previous, HOME: home, XDG_CONFIG_HOME: config, XDG_DATA_HOME: join(home, 'data'),
      XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state'),
      OPENCODE_CONFIG: configuration, OPENCODE_CONFIG_DIR: join(config, 'opencode'),
      OPENCODE_SERVER_PASSWORD: 'synthetic-not-the-server-password', OPENAI_API_KEY: 'synthetic-not-a-key' };
    try { server = await isolatedOpenCode(root, { signal: t.signal }); }
    finally { process.env = previous; }
    const query = '?' + new URLSearchParams({ 'location[directory]': directory });
    const deadline = AbortSignal.timeout(10000);
    while (!(await server.api('GET', '/api/agent' + query, undefined, deadline)).data.some(agent => agent.id === 'isolated-fixture')) {
      await delay(100, undefined, { signal: deadline });
    }
    await server.verifyLocation(directory);
    assert.ok(!(await server.api('GET', '/api/mcp' + query)).data.some(mcp => mcp.name === 'isolation-canary'));
    assert.deepEqual((await server.api('GET', '/api/credential')).data, []);
    await assert.rejects(access(marker), { code: 'ENOENT' });
  });
