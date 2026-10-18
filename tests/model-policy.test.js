import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, chmod, cp, link, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import plugin from '../plugins/pstack/index.js';
import { assertModelAvailable, loadModelPolicy, parseModelPolicy, parseModelRef, resolveModel } from '../plugins/pstack/models.js';
import { makeTempDir } from './helpers/temp.js';
import { createServer } from 'node:http';

const exec = promisify(execFile);
const source = fileURLToPath(new URL('../', import.meta.url));
const expected = {
  coordination: { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'high' },
  implementation: { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'high' },
  hard: { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'xhigh' },
  investigation: { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'medium' },
  review: { providerID: 'openai', id: 'gpt-6-astra', variant: 'high' },
  mechanical: { providerID: 'openai', id: 'gpt-5.3-codex-spark', variant: 'high' },
};
const roleTasks = { poteto: 'coordination', 'poteto-agent': 'implementation',
  'poteto-reviewer': 'review', 'poteto-investigator': 'investigation' };
const inventory = [
  { providerID: 'openai', id: 'gpt-6.1-sol', modelID: 'not-the-reference-id', enabled: true,
    variants: [{ id: 'medium' }, { id: 'high' }, { id: 'xhigh' }] },
  { providerID: 'openai', id: 'gpt-6-astra', enabled: true, variants: [{ id: 'high' }] },
  { providerID: 'openai', id: 'gpt-5.3-codex-spark', enabled: true, variants: [{ id: 'high' }] },
];

test('policy resolves all approved tasks and role defaults to exact model references', async () => {
  const policy = await loadModelPolicy(source);
  for (const [task, model] of Object.entries(expected)) {
    assert.deepEqual(resolveModel(policy, 'poteto-agent', task), { task, model });
  }
  for (const [role, task] of Object.entries(roleTasks)) {
    assert.deepEqual(resolveModel(policy, role), { task, model: expected[task] });
  }
  assert.deepEqual(parseModelRef('provider/org/model#variant'), { providerID: 'provider', id: 'org/model', variant: 'variant' });
  for (const task of ['typo', '', null, 'toString', 'constructor']) {
    assert.throws(() => resolveModel(policy, 'poteto-agent', task), /Unknown pstack model task/);
  }
  assert.throws(() => resolveModel(policy, 'unknown'), /Unknown pstack model role/);
});

test('malformed policy data is rejected instead of inheriting a parent model', async () => {
  const valid = JSON.parse(await readFile(join(source, 'pstack-models.json'), 'utf8'));
  const mutations = [
    value => { value.version = 2; },
    value => { value.credentials = {}; },
    value => { delete value.tasks.hard; },
    value => { value.tasks.extra = value.tasks.review; },
    value => { value.tasks = []; },
    value => { value.defaults['poteto-agent'] = 'unknown'; },
    value => { delete value.defaults.poteto; },
    value => { value.defaults.extra = 'review'; },
    ...['auto', 'inherit-parent', '', 'openai/model', 'openai/model#', 'openai/model#high#extra',
      'openai//model#high', 'openai/model#high\n', { providerID: 'openai', id: 'model' }]
      .map(model => value => { value.tasks.implementation = model; }),
  ];
  for (const mutation of mutations) {
    const value = structuredClone(valid);
    mutation(value);
    assert.throws(() => parseModelPolicy(value), /Invalid pstack model policy/);
  }
  for (const value of [null, [], {}, 1]) assert.throws(() => parseModelPolicy(value), /Invalid pstack model policy/);
});

test('availability requires the exact provider, public id, enabled state, and variant', () => {
  assert.doesNotThrow(() => assertModelAvailable(expected.hard, inventory));
  const candidate = inventory[0];
  for (const entries of [[], [{ ...candidate, providerID: 'other' }], [{ ...candidate, id: 'other' }],
    [{ ...candidate, enabled: false }], [{ ...candidate, variants: [{ id: 'high' }] }]]) {
    assert.throws(() => assertModelAvailable(expected.hard, entries), /unavailable, disabled, or missing its variant/);
  }
});

async function syncFixture(t) {
  const root = await makeTempDir('pstack-model-sync-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'plugins/pstack'), { recursive: true });
  for (const path of ['agents', 'pstack-models.json', 'package.json', 'scripts/sync_models.mjs', 'plugins/pstack/models.js']) {
    await cp(join(source, path), join(root, path), { recursive: true });
  }
  return { root, run: (...args) => exec(process.execPath, [join(root, 'scripts/sync_models.mjs'), ...args]) };
}

test('synchronization checks drift, changes only model frontmatter, and preserves permissions and line endings', async t => {
  const { root, run } = await syncFixture(t);
  const originals = new Map();
  for (const role of Object.keys(roleTasks)) {
    const path = join(root, 'agents', role + '.md');
    let text = (await readFile(path, 'utf8')).replace(/^model:.*$/m, 'model: obsolete/model#low');
    text += '\nmodel: body text must not change\n';
    if (role === 'poteto') text = text.replaceAll('\n', '\r\n');
    await writeFile(path, text);
    await chmod(path, role === 'poteto-reviewer' ? 0o640 : 0o600);
    originals.set(role, { text, mode: (await lstat(path)).mode });
  }
  await assert.rejects(run('--check'), /Agent model drift/);
  for (const [role, { text }] of originals) assert.equal(await readFile(join(root, 'agents', role + '.md'), 'utf8'), text);
  await run();
  for (const [role, { text, mode }] of originals) {
    const path = join(root, 'agents', role + '.md');
    const model = expected[roleTasks[role]];
    assert.equal(await readFile(path, 'utf8'), text.replace('model: obsolete/model#low', `model: ${model.providerID}/${model.id}#${model.variant}`));
    assert.equal((await lstat(path)).mode, mode);
  }
  await run('--check');
  await run();
  await assert.rejects(run('--unknown'), /Usage:/);
});

test('synchronization refuses hardlinked agents without changing another directory entry', async t => {
  const { root, run } = await syncFixture(t);
  for (const role of ['poteto', 'poteto-reviewer']) {
    const path = join(root, 'agents', role + '.md');
    await writeFile(path, (await readFile(path, 'utf8')).replace(/^model:.*$/m, 'model: obsolete/model#low'));
  }
  const sentinel = join(root, 'outside-agents.md');
  await link(join(root, 'agents', 'poteto-reviewer.md'), sentinel);
  const before = await readFile(sentinel, 'utf8');
  const snapshots = await Promise.all(Object.keys(roleTasks).map(role => readFile(join(root, 'agents', role + '.md'), 'utf8')));
  await assert.rejects(run(), /Refusing a hardlinked agent/);
  assert.equal(await readFile(sentinel, 'utf8'), before);
  assert.deepEqual(await Promise.all(Object.keys(roleTasks).map(role => readFile(join(root, 'agents', role + '.md'), 'utf8'))), snapshots);
});

test('synchronization refuses symlink files and directories without writing any agent', async t => {
  for (const kind of ['file', 'directory']) {
    await t.test(kind, async t => {
      const { root, run } = await syncFixture(t);
      const path = join(root, 'agents', 'poteto.md');
      const before = await readFile(path, 'utf8');
      await writeFile(path, before.replace(/^model:.*$/m, 'model: obsolete/model#low'));
      const target = kind === 'file' ? join(root, 'agents', 'poteto-investigator.md') : join(root, 'agents');
      const retained = join(root, 'retained');
      await cp(target, retained, { recursive: true });
      await rm(target, { recursive: true });
      await symlink(retained, target, kind === 'file' ? 'file' : 'dir');
      const snapshots = await Promise.all(Object.keys(roleTasks).map(role => readFile(join(root, 'agents', role + '.md'), 'utf8')));
      await assert.rejects(run(), /Refusing a symlink/);
      assert.deepEqual(await Promise.all(Object.keys(roleTasks).map(role => readFile(join(root, 'agents', role + '.md'), 'utf8'))), snapshots);
    });
  }
});

// The native client uses a loopback service. Registered worker policy,
// permissions and local bootstrap remain production code.
async function dispatchFixture(t, policyText) {
  const root = await makeTempDir('pstack-model-dispatch-');
  const bin = join(root, 'bin');
  const project = join(root, 'project');
  await mkdir(bin);
  await mkdir(project);
  await writeFile(join(root, 'calls'), '');
  const listener = createServer(async (request, response) => {
    try {
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : undefined;
      const method = request.method.toLowerCase();
      const route = request.url;
      await appendFile(join(root, 'calls'), JSON.stringify({ command: 'http', args: ['api', method, route, ...(body ? ['--data', JSON.stringify(body)] : [])] }) + '\n');
      response.setHeader('content-type', 'application/json');
      if (route === '/api/info') response.end(await readFile(join(root, 'server.json'), 'utf8'));
      else if (route === '/api/session' && method === 'post') response.end(JSON.stringify({ data: body }));
      else if (/^\/api\/session\/ses_[a-zA-Z0-9]+\/prompt$/.test(route) && method === 'post') response.end(JSON.stringify({ data: body }));
      else { response.writeHead(404); response.end(); }
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(async () => { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); });
  const registrationFile = join(root, 'service.json');
  await writeFile(registrationFile, JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${listener.address().port}` }), { mode: 0o600 });
  await writeFile(join(root, 'server.json'),JSON.stringify({pid:process.pid,version:'fixture',
    urls:[`http://127.0.0.1:${listener.address().port}`],paths:{tmp:root}}));
  const parent = { id: 'ses_parent', location: { directory: project },
    model: { providerID: 'different-provider', id: 'different-parent', variant: 'different-effort' },
    permissions: [{ action: 'external-write', resource: '*', effect: 'deny' },
      { action: 'sensitive', resource: '*', effect: 'ask' }, { action: 'parent-allow', resource: '*', effect: 'allow' }] };
  await writeFile(join(root, 'parent.json'), JSON.stringify(parent));
  await writeFile(join(bin, 'transport.cjs'), String.raw`#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(__dirname);
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify({ command, args }) + '\n');
if (command === 'opencode') {
  if (args[0] !== 'api') process.exit(91);
  const [_, method, route] = args;
   if (method === 'get' && route === '/api/session/ses_parent') {
     process.stdout.write(JSON.stringify({data: JSON.parse(fs.readFileSync(path.join(root, 'parent.json'), 'utf8'))}));
   } else process.exit(92);
} else if (command === 'git') {
  if (args[0] === 'rev-parse') process.stdout.write('a'.repeat(40) + '\n');
  else if (args[0] === 'clone') fs.mkdirSync(args.at(-1));
  else if (args[0] === 'worktree' && args[1] === 'add') fs.mkdirSync(args.at(-2));
  else if (args[0] !== 'checkout') process.exit(93);
} else if (command === 'docker') {
  if (args[0] === 'image' && args[1] === 'inspect') process.stdout.write('[]');
  else if (args[0] === 'run') {
    const labels = Object.fromEntries(args.flatMap((value, index) => value === '--label' ? [args[index + 1].split('=')] : []));
    fs.writeFileSync(path.join(root, 'container.json'), JSON.stringify({ Id: 'c'.repeat(64), Config: { Labels: labels }, State: { Running: true } }));
    process.stdout.write('c'.repeat(64) + '\n');
  } else if (args[0] === 'inspect' && args[1] === 'c'.repeat(64)) {
    process.stdout.write('[' + fs.readFileSync(path.join(root, 'container.json'), 'utf8') + ']');
  }
  else process.exit(94);
} else process.exit(95);
`, { mode: 0o755 });
  for (const name of ['opencode', 'git', 'docker']) await symlink('transport.cjs', join(bin, name));
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  const calls = async () => (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  t.after(async () => {
    process.env.PATH = previousPath;
    for (const call of await calls()) {
      if (call.command !== 'git' || !['clone', 'worktree'].includes(call.args[0])) continue;
      const checkout = call.args[0] === 'clone' ? call.args.at(-1) : call.args.at(-2);
      assert.ok(basename(dirname(checkout)).startsWith('pstack-worker-'));
      await rm(dirname(checkout), { recursive: true, force: true });
    }
    await rm(root, { recursive: true, force: true });
  });
  let registered = plugin;
  if (policyText !== undefined) {
    const bundle = join(root, 'bundle');
    await mkdir(bundle);
    await cp(join(source, 'plugins'), join(bundle, 'plugins'), { recursive: true });
    await cp(join(source, 'package.json'), join(bundle, 'package.json'));
    await symlink(join(source, 'node_modules'), join(bundle, 'node_modules'), 'dir');
    await writeFile(join(bundle, 'pstack-models.json'), policyText);
    registered = (await import(pathToFileURL(join(bundle, 'plugins/pstack/index.js')).href)).default;
  }
  const records = new Map();
  const permissions = [];
  const lookups = [];
  let models = structuredClone(inventory);
  const tools = new Map();
  const cleanup = await registered.setup({ location: { directory: project },
    options: { server: { registrationFile }, admission: { directory: join(root, 'admission'), limits: { activeWorkers: 20 } } },
    storage: { async scan() { return { entries: [] }; }, async get(key) { return records.get(key); },
      async set(key, value) { records.set(key, structuredClone(value)); } },
    permission: { async hook() {}, async assert(request) { permissions.push(structuredClone(request)); } },
    session: {}, model: { async list(input) { lookups.push(input); return { data: models }; } },
    tool: { async transform(edit) { edit({ namespace() {}, add(tool) { tools.set(tool.name, tool); } }); } },
  });
  t.after(cleanup);
  assert.deepEqual(lookups, [], 'Plugin setup must not require credentials or an available model');
  const tool = tools.get('worker');
  return { project, parent, records, permissions, lookups, tool, calls,
    unavailable() { models = []; },
    async run(input) {
      const result = await tool.execute({ action: 'start', prompt: 'Bounded fixture task', ref: 'HEAD', ...input },
        { sessionID: parent.id, agent: 'poteto', messageID: 'msg_fixture', id: 'tool_fixture', signal: t.signal });
      return JSON.parse(result.content);
    },
  };
}

test('registered worker dispatch routes both backends independently of parent model and role permissions', { timeout: 60000 }, async t => {
  const f = await dispatchFixture(t);
  assert.deepEqual(f.tool.input.properties.task.enum, Object.keys(expected));
  assert.equal(f.tool.input.properties.model, undefined);
  assert.equal(f.tool.input.additionalProperties, false);
  for (const backend of ['local', 'container']) {
    for (const [role, task] of [['poteto-agent', undefined], ['poteto-reviewer', undefined],
      ['poteto-investigator', undefined], ['poteto-reviewer', 'hard'], ['poteto-reviewer', 'mechanical']]) {
      const permissionsBefore = f.permissions.length;
      const record = await f.run({ backend, role, ...(task ? { task } : {}) });
      const selected = task ?? roleTasks[role];
      assert.equal(record.role, role);
      assert.equal(record.task, selected);
      assert.deepEqual(record.model, expected[selected]);
      assert.deepEqual([...f.records.values()].find(saved => saved.id === record.id), record);
      const calls = await f.calls();
      const create = calls.filter(call => call.command === 'http' && call.args[1] === 'post' && call.args[2] === '/api/session').at(-1);
      const body = JSON.parse(create.args[4]);
      assert.deepEqual(body.model, expected[selected]);
      assert.notDeepEqual(body.model, f.parent.model);
      assert.equal(body.agent, backend === 'container' ? 'pstack-container' : role);
      assert.ok(body.permissions.some(rule => rule.action === 'external-write' && rule.effect === 'deny'));
      assert.ok(body.permissions.some(rule => rule.action === 'sensitive' && rule.effect === 'ask'));
      assert.ok(!body.permissions.some(rule => rule.action === 'parent-allow'));
      if (backend === 'local') {
        for (const action of ['subagent', 'pstack_worker', ...(role === 'poteto-agent' ? [] : ['edit', 'shell', 'pstack_terminal'])]) {
          assert.ok(body.permissions.some(rule => rule.action === action && rule.effect === 'deny'), `${role} ${action}`);
        }
      } else {
        const mount = calls.filter(call => call.command === 'docker' && call.args[0] === 'run').at(-1).args.find(arg => arg.startsWith('type=bind,'));
        assert.equal(mount.endsWith(',readonly'), role !== 'poteto-agent');
        assert.ok(body.permissions.some(rule => rule.action === 'shell' && rule.effect === (role === 'poteto-agent' ? 'allow' : 'ask')));
      }
      assert.deepEqual(f.permissions.slice(permissionsBefore).map(request => [request.action, request.resources]),
        [['pstack_worker', ['start']], ['subagent', [role]]]);
    }
  }
  assert.ok(f.lookups.every(input => input.location.directory === f.project));
  assert.ok(!(await f.calls()).some(call => call.command === 'opencode' && /credential|switch-model/.test(call.args[2])));
});

test('registered worker rejects invalid tasks and unavailable models before Git or container commands', async t => {
  const f = await dispatchFixture(t);
  for (const backend of ['local', 'container']) {
    await assert.rejects(f.run({ backend, task: 'unknown' }), /Unknown pstack model task/);
  }
  assert.deepEqual(f.lookups, []);
  f.unavailable();
  for (const backend of ['local', 'container']) {
    await assert.rejects(f.run({ backend }), /unavailable, disabled, or missing its variant/);
  }
  assert.deepEqual(f.permissions, []);
  assert.equal(f.records.size, 0);
  assert.ok((await f.calls()).every(call => call.command === 'opencode' && call.args[1] === 'get'));
});

test('registered worker reports malformed policy before inventory or resource acquisition', async t => {
  const f = await dispatchFixture(t, '{"version":1,"tasks":{}}');
  await assert.rejects(f.run({ backend: 'container' }), /Cannot load pstack model policy.*Invalid pstack model policy/);
  assert.deepEqual(f.lookups, []);
  assert.deepEqual(f.permissions, []);
  assert.equal(f.records.size, 0);
  assert.ok((await f.calls()).every(call => call.command === 'opencode' && call.args[1] === 'get'));
});
