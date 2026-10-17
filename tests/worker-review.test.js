import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import plugin from '../plugins/pstack/index.js';
import { WorkerHistory } from '../plugins/pstack/worker-history.js';
import { workerManifest } from '../plugins/pstack/worker-artifacts.js';
import { makeTempDir } from './helpers/temp.js';

const exec = promisify(execFile);
const source = resolve(import.meta.dirname, '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const unavailable = { message: 'Approved worker manifest is unavailable or changed' };
const toolContext = () => ({ sessionID: 'ses_requester', agent: 'poteto',
  messageID: 'msg_fixture', id: randomUUID(), signal: new AbortController().signal });

// The SDK services and Docker process are fixtures. Tool registration, review,
// WorkerHistory and repository capture are production code, not native dispatch.
async function fixture(t, engineDirectory) {
  const project = await makeTempDir('pstack-worker-review-');
  const directory = join(project, 'checkout');
  await exec('git', ['clone', '--quiet', '--no-hardlinks', '--', source, directory]);
  const ref = (await exec('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  await writeFile(join(directory, 'review-output.txt'), 'fixture output bytes');
  const worker = { id: randomUUID(), owner: 'ses_owner', sessionID: 'ses_worker', directory,
    role: 'poteto-agent', backend: 'container', ref, engine: 'docker' };
  worker.container = `pstack-${worker.id}`;
  const container = { Id: 'fixture-container-id', Config: { Labels: {
    'pstack.owner': worker.owner, 'pstack.worker': worker.id,
  } }, State: { Status: 'exited', Running: false, Paused: false, Restarting: false,
    ExitCode: 0, StartedAt: 'fixture-start', FinishedAt: 'fixture-finish' }, RestartCount: 0 };
  const containerFile = join(engineDirectory, worker.container + '.json');
  const saveContainer = () => writeFile(containerFile, JSON.stringify(container));
  await saveContainer();
  const prefix = hash(project).slice(0, 24) + '/worker/';
  const records = new Map([[prefix + worker.id, structuredClone(worker)]]);
  const reads = [];
  const writes = [];
  const storage = {
    async get(key) {
      reads.push(key);
      await f.onRead?.(key);
      return structuredClone(records.get(key));
    },
    async set(key, value) { writes.push([key, value]); throw new Error('Unexpected storage mutation'); },
    async scan() { return { entries: [] }; },
  };
  const requests = [];
  const pending = [];
  const waiting = [];
  const hooks = [];
  const denied = new Error('Fixture policy denied');
  let effect = 'allow';
  const permission = {
    async hook(name, hook) { assert.equal(name, 'evaluate'); hooks.push(hook); },
    async assert(request) {
      requests.push(structuredClone(request));
      const event = { ...request, effect };
      for (const hook of hooks) await hook(event);
      if (event.effect === 'deny') throw denied;
      assert.equal(event.effect, 'ask', 'Configured or saved allows must not bypass fresh approval');
      return new Promise((approve, reject) => {
        const admission = { request: structuredClone(request), event, approve, reject };
        if (waiting.length) waiting.shift()(admission);
        else pending.push(admission);
      });
    },
  };
  const sessions = [];
  const tools = new Map();
  const f = { project, worker, prefix, records, reads, writes, requests, sessions, container,
    saveContainer, denied, storage, permission,
    sessionDirectory: project,
    setEffect(value) { effect = value; },
    approval() { return pending.length ? Promise.resolve(pending.shift()) : new Promise(resolve => waiting.push(resolve)); },
    get record() { return records.get(prefix + worker.id); },
  };
  const cleanup = await plugin.setup({ location: { directory: project }, storage, permission,
    session: { async get({ sessionID }) {
      sessions.push(sessionID);
      assert.equal(sessionID, 'ses_requester', 'Never fetch the worker or owner session');
      return { location: { directory: f.sessionDirectory } };
    } },
    tool: { async transform(edit) { edit({ namespace() {}, add(tool) { tools.set(tool.name, tool); } }); } },
  });
  t.after(cleanup);
  const baseline = await workerManifest(new WorkerHistory(storage, prefix), worker.owner, worker.id);
  reads.length = 0;
  f.input = { id: worker.id, expectedOwner: worker.owner, artifactDigest: baseline.artifactDigest };
  f.tool = tools.get('worker_review');
  f.run = (input = f.input, context = toolContext()) => f.tool.execute(input, context).then(result => JSON.parse(result.content));
  f.approved = async (input = f.input) => {
    const result = f.run(input);
    result.catch(() => {});
    const approval = await f.approval();
    approval.approve();
    return result;
  };
  return f;
}

test('manifest-only review uses the registered production tool and real Git artifacts', { timeout: 120000 }, async t => {
  const engineDirectory = await makeTempDir('pstack-review-engine-fixture-');
  await writeFile(join(engineDirectory, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const base = __dirname;
fs.appendFileSync(path.join(base, 'calls'), JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv.length !== 4 || process.argv[2] !== 'inspect' || !/^pstack-[a-f0-9-]+$/.test(process.argv[3])) process.exit(9);
process.stdout.write('[' + fs.readFileSync(path.join(base, process.argv[3] + '.json'), 'utf8') + ']');
`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${engineDirectory}:${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; });

  await t.test('only exact manifest inputs are accepted, before any lookup or approval', async t => {
    const f = await fixture(t, engineDirectory);
    assert.deepEqual(f.tool.input.required, ['id', 'expectedOwner', 'artifactDigest']);
    assert.equal(f.tool.input.additionalProperties, false);
    for (const input of [null, [], {}, { ...f.input, id: '../worker' }, { ...f.input, expectedOwner: '*' },
      { ...f.input, artifactDigest: 'a'.repeat(63) }, { ...f.input, artifactDigest: 'A'.repeat(64) },
      ...['messages', 'cursor', 'limit', 'agent', 'source', 'project', 'requester', 'action'].map(key => ({ ...f.input, [key]: 'spoof' }))]) {
      await assert.rejects(f.run(input), /Invalid worker review request/);
    }
    assert.deepEqual(f.sessions, []);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.requests, []);
  });

  await t.test('execution role and source come only from tool context', async t => {
    const f = await fixture(t, engineDirectory);
    for (const patch of [{ agent: 'poteto-agent' }, { agent: 'poteto-reviewer' }, { agent: 'poteto-investigator' },
      { agent: undefined }, { id: undefined }, { messageID: undefined }, { sessionID: '../session' }]) {
      await assert.rejects(f.run(f.input, { ...toolContext(), ...patch }), /primary tool context/);
    }
    assert.deepEqual(f.sessions, []);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.requests, []);
  });

  await t.test('requester outside the canonical project cannot request approval or inspect a worker', async t => {
    const f = await fixture(t, engineDirectory);
    f.sessionDirectory = engineDirectory;
    await assert.rejects(f.run(), /requester is unavailable/);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.requests, []);
  });

  await t.test('deny and rejection preserve the permission error and perform no protected lookup', async t => {
    const f = await fixture(t, engineDirectory);
    const before = await readFile(join(engineDirectory, 'calls'), 'utf8');
    f.setEffect('deny');
    await assert.rejects(f.run(), error => error === f.denied);
    f.setEffect('allow');
    const rejected = f.run();
    const check = assert.rejects(rejected, error => error === f.denied);
    (await f.approval()).reject(f.denied);
    await check;
    assert.deepEqual(f.reads, []);
    assert.equal(await readFile(join(engineDirectory, 'calls'), 'utf8'), before);
  });

  await t.test('every read asks for the canonical exact tuple, then releases metadata without mutation', async t => {
    const f = await fixture(t, engineDirectory);
    const before = structuredClone([...f.records]);
    const status = () => exec('git', ['status', '--porcelain=v1'], { cwd: f.worker.directory }).then(r => r.stdout);
    const statusBefore = await status();
    const context = toolContext();
    for (let i = 0; i < 2; i++) {
      f.reads.length = 0;
      const input = { ...f.input };
      const result = f.run(input, context);
      const approval = await f.approval();
      assert.deepEqual(f.reads, []);
      assert.deepEqual(approval.request, { sessionID: context.sessionID, agent: 'poteto',
        source: { type: 'tool', messageID: context.messageID, id: context.id },
        action: 'pstack_worker_review', resources: [JSON.stringify({ version: 1, project: f.project,
          requester: context.sessionID, worker: f.worker.id, expectedOwner: f.worker.owner,
          digest: f.input.artifactDigest, operation: 'manifest' })], save: [] });
      assert.match(approval.event.message, /Later permission changes may not cancel/);
      input.expectedOwner = 'ses_replacement';
      input.artifactDigest = '0'.repeat(64);
      approval.approve();
      const manifest = await result;
      assert.equal(manifest.artifactDigest, f.input.artifactDigest);
      assert.equal(manifest.worker.owner, 'ses_owner');
      assert.deepEqual(manifest.entries.map(entry => [entry.path, entry.status, entry.after.sha256]),
        [['review-output.txt', 'added', hash('fixture output bytes')]]);
      assert.ok(!JSON.stringify(manifest).includes('fixture output bytes'));
      assert.match(manifest.approval, /No atomic release or revocation guarantee/);
    }
    assert.equal(f.requests.length, 2);
    assert.deepEqual([...f.records], before);
    assert.deepEqual(f.writes, []);
    assert.equal(await status(), statusBefore);
  });

  for (const mismatch of ['worker', 'owner', 'digest', 'project']) {
    await t.test(`approved wrong ${mismatch} fails without revealing paths or replacement digest`, async t => {
      const f = await fixture(t, engineDirectory);
      const input = { ...f.input };
      if (mismatch === 'worker') input.id = randomUUID();
      if (mismatch === 'owner') input.expectedOwner = 'ses_other';
      if (mismatch === 'digest') input.artifactDigest = '0'.repeat(64);
      if (mismatch === 'project') {
        f.records.set('other-project/worker/' + f.worker.id, f.record);
        f.records.delete(f.prefix + f.worker.id);
      }
      await assert.rejects(f.approved(input), unavailable);
      assert.equal(f.requests.length, 1);
      assert.ok(f.reads.every(key => key.startsWith(f.prefix)));
    });
  }

  for (const change of ['artifact', 'owner', 'session', 'local', 'running', 'paused', 'restarting', 'requester project', 'missing checkout']) {
    await t.test(`a waiting approval does not admit changed ${change}`, async t => {
      const f = await fixture(t, engineDirectory);
      const result = f.run();
      const check = assert.rejects(result, unavailable);
      const approval = await f.approval();
      assert.deepEqual(f.reads, []);
      if (change === 'artifact') await writeFile(join(f.worker.directory, 'review-output.txt'), 'replacement private bytes');
      if (change === 'owner') f.record.owner = 'ses_replacement';
      if (change === 'session') f.record.sessionID = 'ses_replacement';
      if (change === 'local') f.record.backend = 'local';
      if (change === 'running') Object.assign(f.container.State, { Status: 'running', Running: true });
      if (change === 'paused') f.container.State.Paused = true;
      if (change === 'restarting') f.container.State.Restarting = true;
      if (change === 'requester project') f.sessionDirectory = engineDirectory;
      if (change === 'missing checkout') f.record.directory = join(f.project, 'private-missing-path');
      await f.saveContainer();
      approval.approve();
      await check;
      assert.deepEqual(f.writes, []);
    });
  }

  for (const change of ['identity', 'owner', 'artifact', 'lifecycle']) {
    await t.test(`post-capture ${change} revalidation prevents release`, async t => {
      const f = await fixture(t, engineDirectory);
      let reads = 0;
      f.onRead = async () => {
        if (++reads < 3) return;
        if (change === 'identity') f.record.sessionID = 'ses_replacement';
        if (change === 'owner') f.record.owner = 'ses_replacement';
        if (change === 'artifact') await writeFile(join(f.worker.directory, 'review-output.txt'), 'changed after initial capture');
        if (change === 'lifecycle') {
          Object.assign(f.container.State, { Status: 'running', Running: true });
          await f.saveContainer();
        }
      };
      await assert.rejects(f.approved(), unavailable);
    });
  }

  await t.test('each concurrent call requires its own approval; later permission changes do not promise cancellation', async t => {
    const f = await fixture(t, engineDirectory);
    const first = f.run();
    const a = await f.approval();
    const second = f.run();
    const rejected = assert.rejects(second, error => error === f.denied);
    const b = await f.approval();
    assert.notEqual(a.request.source.id, b.request.source.id);
    f.setEffect('deny');
    a.approve();
    assert.equal((await first).artifactDigest, f.input.artifactDigest);
    b.reject(f.denied);
    await rejected;
    await assert.rejects(f.run(), error => error === f.denied);
    assert.equal(f.requests.length, 3);
  });

  const calls = (await readFile(join(engineDirectory, 'calls'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.length > 0);
  assert.ok(calls.every(([command]) => command === 'inspect'), 'Review never stops, starts or executes in a container');
});
