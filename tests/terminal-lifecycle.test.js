import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises';
import { Terminal } from '../plugins/pstack/terminal.js';
import plugin from '../plugins/pstack/index.js';
import { makeTempDir } from './helpers/temp.js';

async function bridgeFixture(t) {
  const root = await makeTempDir('pstack-terminal-lifecycle-');
  const previousPath = process.env.PATH;
  const f = { root, files: async suffix => (await readdir(root)).filter(name => name.endsWith(suffix)) };
  f.teardown = async () => {
    try {
      await writeFile(join(root, 'release-start'), 'release');
      await writeFile(join(root, 'release-close'), 'release');
      await f.cleanup?.();
      await Promise.all((await f.files('.spawned')).map(file => stopped(Number(file.split('.')[0]))));
      await rm(root, { recursive: true, force: true });
      await assert.rejects(readdir(root), { code: 'ENOENT' });
    } finally { process.env.PATH = previousPath; }
  };
  t.after(() => f.teardown());
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'python3'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = ${JSON.stringify(root)};
fs.writeFileSync(path.join(root, process.pid + '.spawned'), 'spawned');
const listen = () => {
if (fs.existsSync(path.join(root, 'hold-request')) && !fs.existsSync(path.join(root, 'release-request'))) return setTimeout(listen, 10);
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  fs.writeFileSync(path.join(root, process.pid + '.started'), 'started');
  if (!fs.existsSync(path.join(root, 'hold-start')) || fs.existsSync(path.join(root, 'release-start'))) process.stdout.write(JSON.stringify({id:request.id,output:'fixture',exitCode:null}) + '\\n');
});
process.stdin.on('end', () => {
  fs.writeFileSync(path.join(root, process.pid + '.closing'), 'closing');
  const finish = () => {
    if (fs.existsSync(path.join(root, 'hold-close')) && !fs.existsSync(path.join(root, 'release-close'))) return setTimeout(finish, 10);
    fs.writeFileSync(path.join(root, process.pid + '.closed'), 'closed');
    process.exit(fs.existsSync(path.join(root, 'fail-close')) ? 42 : 0);
  };
  setTimeout(finish, 100);
});
};
listen();
`, { mode: 0o700 });
  await writeFile(join(bin, 'opencode'), `#!${process.execPath}
if (process.argv.slice(2).join(' ') !== 'api get /api/session/ses_terminalowner') process.exit(90);
process.stdout.write(JSON.stringify({data:{id:'ses_terminalowner',location:{directory:${JSON.stringify(root)}}}}));
`, { mode: 0o700 });
  process.env.PATH = `${bin}:${previousPath}`;
  return f;
}

async function waitFiles(f, suffix, count) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const files = await f.files(suffix);
    if (files.length === count) return files;
    await delay(10);
  }
  assert.fail(`Expected ${count} ${suffix} bridge markers`);
}

async function terminalRuntime(t, f) {
  let terminalTool;
  const cleanup = await plugin.setup({ location: { directory: f.root }, options: {},
    storage: { async scan() { return { entries: [] }; }, async get() {}, async set() {} },
    permission: { async hook() {}, async assert() {} },
    tool: { async transform(register) { register({ namespace() {}, add(tool) { if (tool.name === 'terminal') terminalTool = tool; } }); } },
  });
  const pending = new Set();
  const unresolved = new Set();
  f.reconcileStartup = async (error, pid) => {
    assert.ok(unresolved.has(error), 'Reconciliation requires the exact unconfirmed startup error');
    assert.ok((await f.files('.spawned')).includes(`${pid}.spawned`), 'Exit proof requires a known owned PID');
    await stopped(pid);
    await Promise.all((await f.files('.spawned')).map(file => stopped(Number(file.split('.')[0]))));
    unresolved.delete(error);
  };
  f.cleanup = async () => {
    await cleanup();
    await Promise.allSettled([...pending]);
    if (unresolved.size) throw new AggregateError([...unresolved], 'Fixture startup closures remain unconfirmed');
  };
  return (input, signal = t.signal) => {
    const operation = terminalTool.execute(input, { sessionID: 'ses_terminalowner', agent: 'poteto',
      signal, messageID: 'msg_fixture', id: 'fixture' }).then(result => JSON.parse(result.content)).catch(error => {
        if (input.action === 'start' && error instanceof AggregateError) unresolved.add(error);
        throw error;
      }).finally(() => pending.delete(operation));
    pending.add(operation);
    return operation;
  };
}

test('terminal close confirms bridge exit rather than only ending input', { timeout: 5000 }, async t => {
  const f = await bridgeFixture(t);
  const terminal = new Terminal();
  f.cleanup = () => terminal.close();
  await terminal.request({ action: 'start', argv: ['fixture'], cwd: f.root });
  let settled = false;
  const closing = terminal.close().then(result => { settled = true; return result; });
  await turn();
  assert.equal(settled, false);
  await assert.rejects(terminal.request({ action: 'send', text: 'must not be sent' }), /closing|closed/);
  assert.deepEqual(await closing, { closed: true });
  assert.equal((await f.files('.closed')).length, 1);
  assert.deepEqual(await terminal.close(), { closed: true });
});

test('terminal starts recheck capacity after simultaneous permission waits', { timeout: 15000 }, async t => {
  const f = await bridgeFixture(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let ready;
  const allWaiting = new Promise(resolve => { ready = resolve; });
  let approvals = 0;
  let terminalTool;
  const cleanup = await plugin.setup({ location: { directory: f.root }, options: {},
    storage: { async scan() { return { entries: [] }; }, async get() {}, async set() {} },
    permission: { async hook() {}, async assert({ action }) {
      if (action === 'pstack_terminal') { if (++approvals === 12) ready(); await gate; }
    } },
    tool: { async transform(register) { register({ namespace() {}, add(tool) { if (tool.name === 'terminal') terminalTool = tool; } }); } },
  });
  f.cleanup = async () => {
    release();
    await cleanup();
    for (const result of await outcomes) {
      if (result.status === 'rejected' && result.reason instanceof AggregateError) throw result.reason;
    }
  };
  const context = { sessionID: 'ses_terminalowner', agent: 'poteto', signal: t.signal, messageID: 'msg_fixture', id: 'fixture' };
  const pending = Array.from({ length: 12 }, () => terminalTool.execute({ action: 'start', command: 'fixture' }, context));
  const outcomes = Promise.allSettled(pending);
  await allWaiting;
  release();
  const results = await outcomes;
  const started = results.filter(result => result.status === 'fulfilled').map(result => JSON.parse(result.value.content));
  assert.equal(started.length, 8);
  assert.equal(results.filter(result => result.status === 'rejected').length, 4);
  assert.equal((await f.files('.started')).length, 8, 'Denied starts must not spawn extra bridges');
  await Promise.all(started.map(({ id }) => terminalTool.execute({ action: 'close', id }, context)));
  assert.equal((await f.files('.closed')).length, 8, 'Close replies require confirmed bridge exits');
});

test('aborting a held production terminal start confirms owned bridge closure and restores capacity', { timeout: 10000 }, async t => {
  const f = await bridgeFixture(t);
  await writeFile(join(f.root, 'hold-start'), 'hold');
  const execute = await terminalRuntime(t, f);
  const controller = new AbortController();
  const pending = execute({ action: 'start', command: 'fixture' }, controller.signal);
  const rejected = assert.rejects(pending, /closure requested|abort/i);
  await waitFiles(f, '.started', 1);
  controller.abort();
  await rejected;
  assert.equal((await f.files('.closed')).length, 1, 'Aborted start settles only after the owned bridge exits');
  await writeFile(join(f.root, 'release-start'), 'release');
  const started = await Promise.all(Array.from({ length: 8 }, () => execute({ action: 'start', command: 'fixture' })));
  await assert.rejects(execute({ action: 'start', command: 'fixture' }), /Close an existing terminal/);
  await Promise.all(started.map(({ id }) => execute({ action: 'close', id })));
  assert.equal((await f.files('.closed')).length, 9);
});

test('an unconfirmed five-second bridge close retains capacity until later owned process cleanup', { timeout: 15000 }, async t => {
  const f = await bridgeFixture(t);
  await writeFile(join(f.root, 'hold-start'), 'hold');
  await writeFile(join(f.root, 'hold-close'), 'hold');
  const execute = await terminalRuntime(t, f);
  const controller = new AbortController();
  const pending = execute({ action: 'start', command: 'fixture' }, controller.signal);
  let startupError;
  const rejected = assert.rejects(pending, error => {
    startupError = error;
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /closure is unconfirmed/);
    assert.ok(error.errors.some(error => /not confirmed within 5 seconds/.test(error.message)));
    return true;
  });
  const [owned] = await waitFiles(f, '.started', 1);
  controller.abort();
  await waitFiles(f, '.closing', 1);
  await rejected;
  assert.equal((await f.files('.closed')).length, 0, 'A requested close is not a confirmed exit');
  await writeFile(join(f.root, 'release-start'), 'release');
  const started = await Promise.all(Array.from({ length: 7 }, () => execute({ action: 'start', command: 'fixture' })));
  await assert.rejects(execute({ action: 'start', command: 'fixture' }), /Close an existing terminal/);
  await writeFile(join(f.root, 'release-close'), 'release');
  await Promise.all(started.map(({ id }) => execute({ action: 'close', id })));
  await f.reconcileStartup(startupError, Number(owned.split('.')[0]));
  assert.equal((await f.files('.closed')).length, 8);
});

test('an unconfirmed startup without a request marker retains its fixture until exact owned exit reconciliation', { timeout: 15000 }, async t => {
  const f = await bridgeFixture(t);
  const execute = await terminalRuntime(t, f);
  const earlier = await execute({ action: 'start', command: 'fixture' });
  await execute({ action: 'close', id: earlier.id });
  const [earlierSpawn] = await f.files('.spawned');
  const earlierRequests = await f.files('.started');
  await writeFile(join(f.root, 'hold-request'), 'hold');
  const controller = new AbortController();
  const pending = execute({ action: 'start', command: 'fixture' }, controller.signal);
  let startupError;
  const rejected = pending.catch(error => { startupError = error; });
  let pid;
  try {
    const owned = (await waitFiles(f, '.spawned', 2)).find(file => file !== earlierSpawn);
    pid = Number(owned.split('.')[0]);
    controller.abort();
    await rejected;
    assert.ok(startupError instanceof AggregateError);
    assert.match(startupError.message, /closure is unconfirmed/);
    assert.deepEqual(await f.files('.started'), earlierRequests);
    await assert.rejects(f.reconcileStartup(startupError, Number(earlierSpawn.split('.')[0])), /remains running/);
    await assert.rejects(f.teardown(), error => error instanceof AggregateError && error.errors.includes(startupError));
    await readdir(f.root);
    process.kill(pid, 0);
    assert.deepEqual(await f.files('.started'), earlierRequests, 'Teardown must retain a fixture even without request markers for the pending start');
  } finally {
    await writeFile(join(f.root, 'release-request'), 'release');
    if (pid) await stopped(pid);
    await rejected;
    if (startupError instanceof AggregateError) {
      await assert.rejects(f.cleanup(), error => error instanceof AggregateError && error.errors.includes(startupError));
      await assert.rejects(f.reconcileStartup(new AggregateError([]), pid), /exact unconfirmed startup error/);
      await f.reconcileStartup(startupError, pid);
    }
  }
});

test('a bridge close error does not release a production terminal capacity slot', { timeout: 10000 }, async t => {
  const f = await bridgeFixture(t);
  const execute = await terminalRuntime(t, f);
  const started = await Promise.all(Array.from({ length: 8 }, () => execute({ action: 'start', command: 'fixture' })));
  await writeFile(join(f.root, 'fail-close'), 'fail');
  t.mock.method(console, 'error', () => {});
  await assert.rejects(execute({ action: 'close', id: started[0].id }), /bridge closure failed/);
  await turn();
  await assert.rejects(execute({ action: 'start', command: 'fixture' }), /Close an existing terminal/);
  assert.equal((await f.files('.started')).length, 8);
});

async function stopped(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      if (/^[ZX] /.test(stat.slice(stat.lastIndexOf(')') + 2))) return;
    } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return; throw error; }
    await delay(10);
  }
  assert.fail(`Owned process ${pid} remains running`);
}

test('confirmed native bridge closure stops its terminal process group',
  { skip: process.platform !== 'linux', timeout: 15000 }, async t => {
    for (const exitLeader of [false, true]) await t.test(exitLeader ? 'exited leader' : 'live leader', async t => {
      const root = await makeTempDir('pstack-terminal-native-');
      let terminal;
      let pids;
      t.after(async () => {
        await terminal?.close();
        if (pids) await Promise.all([stopped(pids.leader), stopped(pids.descendant)]);
        await rm(root, { recursive: true, force: true });
        await assert.rejects(readdir(root), { code: 'ENOENT' });
      });
      terminal = new Terminal();
      const script = `const child = require('node:child_process').spawn(process.execPath,
        ['-e', 'process.on("SIGTERM",()=>{});process.send("ready");setInterval(()=>{},1000)'],
        {stdio:['ignore','ignore','ignore','ipc']});
        child.once('message',()=>{console.log(JSON.stringify({leader:process.pid,descendant:child.pid}));
        ${exitLeader ? 'process.exit(0)' : 'setInterval(()=>{},1000)'};});`;
      let output = (await terminal.request({ action: 'start', argv: [process.execPath, '-e', script], cwd: root })).output;
      for (let attempt = 0; attempt < 100 && !output.includes('descendant'); attempt++) {
        await delay(10);
        output += (await terminal.request({ action: 'read' })).output;
      }
      const match = output.match(/\{"leader":\d+,"descendant":\d+\}/);
      assert.ok(match, output);
      pids = JSON.parse(match[0]);
      assert.deepEqual(await terminal.close(), { closed: true });
      await Promise.all([stopped(pids.leader), stopped(pids.descendant)]);
    });
  });
