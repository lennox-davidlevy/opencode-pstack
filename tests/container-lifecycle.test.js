import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { containerOptions, startContainer, inspectContainer, containerCommand } from '../plugins/pstack/containers.js';
import { makeTempDir } from './helpers/temp.js';

const id = 'a'.repeat(64);
const replacement = 'b'.repeat(64);
const worker = { id: 'worker-one', owner: 'session-one', engine: 'docker', container: 'pstack-worker-one',
  directory: '/fixture/checkout', role: 'poteto-agent' };
const info = { Id: id, Config: { Labels: { 'pstack.owner': worker.owner, 'pstack.worker': worker.id } },
  State: { Running: true, Status: 'running', ExitCode: 0, Paused: false, Restarting: false,
    StartedAt: 'start', FinishedAt: 'finish' }, RestartCount: 0 };

async function fixture(t, settings = {}) {
  const directory = await makeTempDir('pstack-container-lifecycle-');
  const path = process.env.PATH;
  const f = {};
  t.after(async () => {
    try {
      await f.release?.();
      const pids = await readFile(join(directory, 'pids'), 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      for (const pid of pids.trim().split('\n').filter(Boolean).map(Number)) {
        let running = true;
        for (let attempt = 0; attempt < 100; attempt++) {
          try { process.kill(pid, 0); }
          catch (error) { if (error.code !== 'ESRCH') throw error; running = false; break; }
          await delay(10);
        }
        assert.equal(running, false, `Fixture engine ${pid} must exit before removing its directory`);
      }
      await rm(directory, { recursive: true, force: true });
      await assert.rejects(readFile(directory), { code: 'ENOENT' });
    } finally { process.env.PATH = path; }
  });
  const config = join(directory, 'config.json');
  const log = join(directory, 'commands.jsonl');
  await writeFile(config, JSON.stringify({ info, id, replacement, ...settings }));
  await writeFile(log, '');
  await writeFile(join(directory, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(join(directory, 'pids'))}, process.pid + '\\n');
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(${JSON.stringify(config)}, 'utf8'));
const log = ${JSON.stringify(log)};
const previous = fs.readFileSync(log, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (config.hang === args[0]) {
  setInterval(() => {}, 1000);
} else if (config.fail === args[0]) {
  process.stderr.write('fixture daemon unavailable'); process.exitCode = 1;
} else if (args[0] === 'inspect') {
  const result = structuredClone(config.info);
  if (config.replace && previous.some(a => a[0] === 'inspect') && args[1] !== config.id) result.Id = config.replacement;
  if (config.drift && previous.some(a => a[0] === 'inspect')) result.Id = config.replacement;
  if (!config.keepRunning && previous.some(a => a[0] === 'stop')) Object.assign(result.State, { Running: false, Status: 'exited' });
  process.stdout.write(JSON.stringify([result]));
} else if (args[0] === 'run') process.stdout.write(config.id + '\\n');
else if (args[0] === 'exec') {
  process.stdout.write(config.overflow ? 'x'.repeat(2 * 1024 * 1024) : 'fixture output');
  process.stderr.write('fixture stderr'); process.exitCode = config.exitCode ?? 0;
}
`, { mode: 0o755 });
  process.env.PATH = directory;
  const commands = async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const reached = async command => {
    for (let n = 0; n < 300; n++) {
      if ((await commands()).some(args => args[0] === command)) return;
      await delay(10);
    }
    throw new Error(`Fixture never received ${command}`);
  };
  return Object.assign(f, { commands, reached });
}

test('container lifecycle uses only the fixture engine', { timeout: 20000 }, async t => {
  await t.test('legacy calls retain results and startup records a verified ID', async t => {
    const f = await fixture(t);
    const options = await containerOptions({});
    assert.deepEqual(options, { engine: 'docker', image: 'opencode-pstack-worker:0.1.0' });
    const started = await startContainer(options, worker);
    assert.deepEqual(started, { engine: 'docker', container: worker.container, containerID: id });
    assert.deepEqual(await containerCommand({ ...worker, ...started }, 'printf hello'),
      { stdout: 'fixture output', stderr: 'fixture stderr', exitCode: 0 });
    const commands = await f.commands();
    const run = commands.find(args => args[0] === 'run');
    for (const flag of ['--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only']) assert.ok(run.includes(flag));
    assert.ok(run.includes(`pstack.owner=${worker.owner}`));
    assert.ok(run.includes(`pstack.worker=${worker.id}`));
    assert.ok(run.includes('type=bind,src=/fixture/checkout,dst=/workspace'));
    assert.deepEqual(commands.find(args => args[0] === 'exec'), ['exec', '--workdir', '/workspace', id,
      '/usr/bin/timeout', '--signal=TERM', '--kill-after=2', '60', '/bin/sh', '-c', 'printf hello']);
  });

  await t.test('review roles retain a read-only checkout', async t => {
    const f = await fixture(t);
    await startContainer({ engine: 'docker', image: 'fixture' }, { ...worker, role: 'poteto-reviewer' });
    assert.ok((await f.commands()).find(args => args[0] === 'run')
      .includes('type=bind,src=/fixture/checkout,dst=/workspace,readonly'));
  });

  await t.test('startup refuses a mismatched returned identity', async t => {
    await fixture(t, { info: { ...info, Id: replacement } });
    await assert.rejects(startContainer({ engine: 'docker', image: 'fixture' }, worker), /identity mismatch/i);
  });

  await t.test('stop and reinspection use the verified ID even after name replacement', async t => {
    const f = await fixture(t, { replace: true });
    const result = await inspectContainer(worker, true);
    assert.equal(result.containerID, id);
    assert.equal(result.running, false);
    assert.deepEqual(await f.commands(), [['inspect', worker.container], ['stop', '--time', '2', id], ['inspect', id]]);
  });

  for (const [name, settings, record] of [
    ['wrong owner', { info: { ...info, Config: { Labels: { 'pstack.owner': 'other', 'pstack.worker': worker.id } } } }, worker],
    ['wrong worker', { info: { ...info, Config: { Labels: { 'pstack.owner': worker.owner, 'pstack.worker': 'other' } } } }, worker],
    ['wrong saved ID', {}, { ...worker, containerID: replacement }],
    ['malformed inspection', { info: { Config: info.Config, State: info.State } }, worker],
  ]) await t.test(`${name} denies stop and exec`, async t => {
    const f = await fixture(t, settings);
    await assert.rejects(inspectContainer(record, true));
    await assert.rejects(containerCommand(record, 'true'));
    assert.ok((await f.commands()).every(args => args[0] === 'inspect'));
  });

  await t.test('reinspection rejects identity drift', async t => {
    await fixture(t, { drift: true });
    await assert.rejects(inspectContainer(worker, true), /identity mismatch/i);
  });

  await t.test('invalid saved identity is rejected before reaching the engine', async t => {
    const f = await fixture(t);
    await assert.rejects(containerCommand({ ...worker, containerID: '--format=unsafe' }, 'true'), /identity/i);
    assert.deepEqual(await f.commands(), []);
  });

  for (const stage of ['image', 'run', 'inspect', 'stop', 'exec']) await t.test(`cancellation reaches ${stage}`, async t => {
    const f = await fixture(t, { hang: stage });
    const controller = new AbortController();
    const operation = stage === 'image' ? containerOptions({}, controller.signal)
      : stage === 'run' ? startContainer({ engine: 'docker', image: 'fixture' }, worker, controller.signal)
      : stage === 'inspect' ? inspectContainer(worker, false, controller.signal)
      : stage === 'stop' ? inspectContainer(worker, true, controller.signal)
      : containerCommand(worker, 'true', controller.signal);
    const rejected = assert.rejects(operation, error => error.name === 'AbortError');
    f.release = async () => { controller.abort(); await rejected; };
    await f.reached(stage);
    controller.abort();
    await rejected;
    if (stage === 'exec') assert.ok((await f.commands()).some(args => args[0] === 'stop' && args.at(-1) === id));
  });

  await t.test('bounded output failure stops the verified container', async t => {
    const f = await fixture(t, { overflow: true });
    await assert.rejects(containerCommand(worker, 'unbounded output'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    assert.ok((await f.commands()).some(args => args[0] === 'stop' && args.at(-1) === id));
  });

  await t.test('cancelled execution exposes cleanup failure as well as cancellation', async t => {
    const f = await fixture(t, { hang: 'exec', fail: 'stop' });
    const controller = new AbortController();
    const operation = containerCommand(worker, 'true', controller.signal);
    const rejected = assert.rejects(operation, error => error instanceof AggregateError
      && error.errors.some(e => e.name === 'AbortError')
      && error.errors.some(e => /fixture daemon unavailable/.test(e.message)));
    f.release = async () => { controller.abort(); await rejected; };
    await f.reached('exec');
    controller.abort();
    await rejected;
  });

  await t.test('cancellation cleanup refuses a changed identity without stopping it', async t => {
    const f = await fixture(t, { hang: 'exec', drift: true });
    const controller = new AbortController();
    const operation = containerCommand(worker, 'true', controller.signal);
    const rejected = assert.rejects(operation, error => error instanceof AggregateError
      && error.errors.some(e => e.name === 'AbortError')
      && error.errors.some(e => /identity mismatch/i.test(e.message)));
    f.release = async () => { controller.abort(); await rejected; };
    await f.reached('exec');
    controller.abort();
    await rejected;
    assert.ok(!(await f.commands()).some(args => args[0] === 'stop'));
  });

  for (const stage of ['inspect', 'stop']) await t.test(`${stage} daemon failure remains visible`, async t => {
    await fixture(t, { fail: stage });
    await assert.rejects(inspectContainer(worker, true), /fixture daemon unavailable/);
  });

  await t.test('stop success without a stopped container is rejected', async t => {
    await fixture(t, { keepRunning: true });
    await assert.rejects(inspectContainer(worker, true), /stop could not be confirmed/);
  });

  await t.test('command failures retain the existing result shape', async t => {
    await fixture(t, { exitCode: 17 });
    assert.deepEqual(await containerCommand(worker, 'false'),
      { stdout: 'fixture output', stderr: 'fixture stderr', exitCode: 17 });
  });
});
