import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

async function ownedDirectory(t, prefix) {
  const directory = await makeTempDir(prefix);
  const pending = new Set();
  let disposal;
  const owned = {
    directory,
    stop() {},
    async close() {},
    track(operation) {
      const promise = Promise.resolve(operation);
      pending.add(promise);
      promise.then(() => pending.delete(promise), () => pending.delete(promise));
      return promise;
    },
    dispose() {
      return disposal ??= (async () => {
        let deadline;
        try {
          await Promise.race([
            (async () => {
              owned.stop();
              while (pending.size) await Promise.allSettled([...pending]);
              await owned.close();
            })(),
            new Promise((_, reject) => {
              deadline = setTimeout(() => reject(new Error('Fixture resources did not settle')), 5000);
            }),
          ]);
          await rm(directory, { recursive: true, force: true });
        } catch (cause) {
          throw new Error(`Review fixture cleanup incomplete; retained ${directory}`, { cause });
        } finally { clearTimeout(deadline); }
      })();
    },
  };
  t.after(() => owned.dispose());
  return owned;
}

// The SDK services and Docker process are fixtures. Tool registration, review,
// WorkerHistory and repository capture are production code, not native dispatch.
async function fixture(t, engine, clone = directory =>
  exec('git', ['clone', '--quiet', '--no-hardlinks', '--', source, directory])) {
  const owned = await ownedDirectory(t, 'pstack-worker-review-');
  engine.children.push(owned);
  return owned.track(setupFixture(owned, engine, clone));
}

async function setupFixture(owned, engine, clone) {
  const project = owned.directory;
  const engineDirectory = engine.directory;
  const directory = join(project, 'checkout');
  await clone(directory);
  const ref = (await exec('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  await writeFile(join(directory, 'review-output.txt'), 'fixture output bytes');
  const worker = { id: randomUUID(), owner: 'ses_owner', sessionID: 'ses_worker', directory,
    role: 'poteto-agent', backend: 'container', ref, engine: 'docker' };
  worker.container = `pstack-${worker.id}`;
  const container = { Id: hash(worker.id), Config: { Labels: {
    'pstack.owner': worker.owner, 'pstack.worker': worker.id,
  } }, State: { Status: 'exited', Running: false, Paused: false, Restarting: false,
    ExitCode: 0, StartedAt: 'fixture-start', FinishedAt: 'fixture-finish' }, RestartCount: 0 };
  const containerFile = join(engineDirectory, worker.container + '.json');
  const saveContainer = () => Promise.all([
    owned.track(writeFile(containerFile, JSON.stringify(container))),
    owned.track(writeFile(join(engineDirectory, container.Id + '.json'), JSON.stringify(container))),
  ]);
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
  const admissions = new Set();
  const hooks = [];
  const denied = new Error('Fixture policy denied');
  let stopping = false;
  owned.stop = () => {
    stopping = true;
    for (const admission of admissions) admission.reject(denied);
    for (const waiter of waiting.splice(0)) waiter.reject(denied);
  };
  let effect = 'allow';
  const permission = {
    async hook(name, hook) { assert.equal(name, 'evaluate'); hooks.push(hook); },
    async assert(request) {
      requests.push(structuredClone(request));
      const event = { ...request, effect };
      for (const hook of hooks) await hook(event);
      if (stopping) throw denied;
      if (event.effect === 'deny') throw denied;
      assert.equal(event.effect, 'ask', 'Configured or saved allows must not bypass fresh approval');
      return new Promise((approve, reject) => {
        const admission = { request: structuredClone(request), event, approve, reject };
        admissions.add(admission);
        if (waiting.length) waiting.shift().resolve(admission);
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
    approval() {
      return pending.length ? Promise.resolve(pending.shift()) :
        owned.track(new Promise((resolve, reject) => waiting.push({ resolve, reject })));
    },
    get record() { return records.get(prefix + worker.id); },
  };
  owned.close = async () => { throw new Error('Plugin setup did not return cleanup; resource closure is uncertain'); };
  const cleanup = await plugin.setup({ location: { directory: project }, storage, permission,
    session: { async get({ sessionID }) {
      sessions.push(sessionID);
      assert.equal(sessionID, 'ses_requester', 'Never fetch the worker or owner session');
      return { location: { directory: f.sessionDirectory } };
    } },
    tool: { async transform(edit) { edit({ namespace() {}, add(tool) { tools.set(tool.name, tool); } }); } },
  });
  owned.close = cleanup;
  const baseline = await workerManifest(new WorkerHistory(storage, prefix), worker.owner, worker.id);
  reads.length = 0;
  f.input = { id: worker.id, expectedOwner: worker.owner, artifactDigest: baseline.artifactDigest };
  f.tool = tools.get('worker_review');
  f.run = (input = f.input, context = toolContext()) =>
    owned.track(f.tool.execute(input, context).then(result => JSON.parse(result.content)));
  f.approved = async (input = f.input) => {
    const result = f.run(input);
    result.catch(() => {});
    const approval = await f.approval();
    approval.approve();
    return result;
  };
  return f;
}

test('review fixture teardown drains work and closes resources before removing only its directory', async t => {
  const owned = await ownedDirectory(t, 'pstack-worker-review-');
  const neighbor = await ownedDirectory(t, 'pstack-worker-review-');
  await writeFile(join(neighbor.directory, 'keep'), 'unrelated fixture');
  const work = Promise.withResolvers();
  const closing = Promise.withResolvers();
  const closed = Promise.withResolvers();
  owned.track(work.promise.then(() => writeFile(join(owned.directory, 'late-write'), 'settled')));
  owned.close = async () => {
    assert.equal(await readFile(join(owned.directory, 'late-write'), 'utf8'), 'settled');
    closing.resolve();
    await closed.promise;
    await stat(owned.directory);
  };
  const disposal = owned.dispose();
  await stat(owned.directory);
  work.resolve();
  await closing.promise;
  await stat(owned.directory);
  closed.resolve();
  await disposal;
  await assert.rejects(stat(owned.directory), { code: 'ENOENT' });
  assert.equal(await readFile(join(neighbor.directory, 'keep'), 'utf8'), 'unrelated fixture');
});

test('review fixture teardown removes a partial checkout after clone setup fails', async t => {
  const engine = { children: [] };
  const hooks = [];
  const failure = new Error('Clone failed after creating files');
  let project;
  t.after(async () => { if (project) await rm(project, { recursive: true, force: true }); });
  await assert.rejects(fixture({ after(hook) { hooks.push(hook); } }, engine, async directory => {
    project = resolve(directory, '..');
    await mkdir(join(directory, '.git'), { recursive: true });
    await writeFile(join(directory, '.git', 'partial'), 'partial clone');
    throw failure;
  }), error => error === failure);
  await stat(join(project, 'checkout', '.git', 'partial'));
  for (const hook of hooks) await hook();
  await assert.rejects(stat(project), { code: 'ENOENT' });
});

test('review fixture teardown reports closure failure and retains the owned directory', async t => {
  let teardown;
  const owned = await ownedDirectory({ after(hook) { teardown = hook; } }, 'pstack-worker-review-');
  t.after(() => rm(owned.directory, { recursive: true, force: true }));
  const failure = new Error('Resource closure failed');
  owned.close = async () => { throw failure; };
  await assert.rejects(teardown(), error => error.cause === failure && error.message.includes(owned.directory));
  await stat(owned.directory);
});

test('manifest-only review uses the registered production tool and real Git artifacts', { timeout: 120000 }, async t => {
  const engine = await ownedDirectory(t, 'pstack-review-engine-fixture-');
  engine.children = [];
  engine.close = async () => {
    await Promise.all(engine.children.map(child => child.dispose()));
    for (const child of engine.children) await assert.rejects(stat(child.directory), { code: 'ENOENT' });
  };
  const engineDirectory = engine.directory;
  await engine.track(writeFile(join(engineDirectory, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const base = __dirname;
fs.appendFileSync(path.join(base, 'calls'), JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv.length !== 4 || process.argv[2] !== 'inspect' || !/^(pstack-[a-f0-9-]+|[a-f0-9]{64})$/.test(process.argv[3])) process.exit(9);
process.stdout.write('[' + fs.readFileSync(path.join(base, process.argv[3] + '.json'), 'utf8') + ']');
`, { mode: 0o755 }));
  const oldPath = process.env.PATH;
  process.env.PATH = `${engineDirectory}:${oldPath}`;
  t.after(() => { process.env.PATH = oldPath; });
  t.after(async () => {
    await engine.dispose();
    await assert.rejects(stat(engineDirectory), { code: 'ENOENT' });
  });

  await t.test('only exact manifest inputs are accepted, before any lookup or approval', async t => {
    const f = await fixture(t, engine);
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
    const f = await fixture(t, engine);
    for (const patch of [{ agent: 'poteto-agent' }, { agent: 'poteto-reviewer' }, { agent: 'poteto-investigator' },
      { agent: undefined }, { id: undefined }, { messageID: undefined }, { sessionID: '../session' }]) {
      await assert.rejects(f.run(f.input, { ...toolContext(), ...patch }), /primary tool context/);
    }
    assert.deepEqual(f.sessions, []);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.requests, []);
  });

  await t.test('requester outside the canonical project cannot request approval or inspect a worker', async t => {
    const f = await fixture(t, engine);
    f.sessionDirectory = engineDirectory;
    await assert.rejects(f.run(), /requester is unavailable/);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.requests, []);
  });

  await t.test('deny and rejection preserve the permission error and perform no protected lookup', async t => {
    const f = await fixture(t, engine);
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
    const f = await fixture(t, engine);
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
      const f = await fixture(t, engine);
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
      const f = await fixture(t, engine);
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
      const f = await fixture(t, engine);
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
    const f = await fixture(t, engine);
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

  await t.test('teardown rejects an abandoned approval before removing its checkout', async t => {
    const f = await fixture(t, engine);
    const rejected = assert.rejects(f.run(), error => error === f.denied);
    await f.approval();
    t.after(async () => {
      await rejected;
      await assert.rejects(stat(f.project), { code: 'ENOENT' });
    });
  });

  const calls = (await readFile(join(engineDirectory, 'calls'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.length > 0);
  assert.ok(calls.every(([command]) => command === 'inspect'), 'Review never stops, starts or executes in a container');
});
