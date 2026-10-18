import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import plugin from '../plugins/pstack/index.js';
import { Admission } from '../plugins/pstack/admission.js';

const source = fileURLToPath(new URL('../', import.meta.url));
const model = { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'high' };
const inventory = [{ ...model, enabled: true, variants: [{ id: 'high' }, { id: 'xhigh' }] }];

async function until(operation) {
  for (let i = 0; i < 200; i++) {
    const result = await operation();
    if (result) return result;
    await delay(10);
  }
  assert.fail('Fixture event did not arrive');
}

// Worker traffic crosses real HTTP and native service discovery. Git and Docker
// remain subprocess fixtures; registered tools and ledger run unchanged.
async function fixture(t, options = {}) {
  const root = await mkdtemp('/tmp/opencode/worker-lifecycle-');
  const bin = join(root, 'bin');
  const project = join(root, 'project');
  const project2 = join(root, 'project2');
  for (const path of [bin, project, project2, join(root, 'sessions'), join(root, 'containers')]) await mkdir(path);
  await writeFile(join(root, 'calls'), '');
  await writeFile(join(root, 'config.json'), '{}');
  const timers = new Set();
  const registrationFile = join(root, 'service.json');
  const password = 'fixture-private-service-password';
  const authorization = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64');
  let onRequest = async () => {};
  const listener = createServer(async (request, response) => {
    try {
      assert.equal(request.headers.authorization, authorization);
      const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
      const method = request.method.toLowerCase();
      const route = request.url;
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : undefined;
      await appendCall({ command: 'http', args: ['api', method, route, ...(body ? ['--data', JSON.stringify(body)] : [])] });
      await onRequest(method, route, body);
      const url = new URL(route, 'http://fixture.invalid');
      const parts = url.pathname.split('/');
      const id = parts[3];
      const sessionPath = join(root, 'sessions', id ?? 'unused');
      const out = value => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); };
      const empty = () => { response.writeHead(204); response.end(); };
      const acquire = async resource => {
        const record = (await readLedger()).find(record => record.intentions.session === body.id || record.intentions.session === id);
        assert.equal(record.resources[resource].attempt.state, 'outstanding');
        return record;
      };
      const admit = () => writeFile(join(root, 'sessions', body.id), JSON.stringify({ ...body, active: true }));
      const interrupt = async () => {
        const session = JSON.parse(await readFile(sessionPath, 'utf8'));
        session.active = false;
        await writeFile(sessionPath, JSON.stringify(session));
      };
      const late = async (type, perform) => {
        await writeFile(join(root, 'dispatched'), JSON.stringify({ type, body }));
        const timer = setTimeout(async () => {
          timers.delete(timer);
          await perform();
          await writeFile(join(root, 'late-settled'), 'yes');
        }, 180);
        timers.add(timer);
      };
      if (route === '/api/info') out(config.server ?? JSON.parse(await readFile(join(root, 'server.json'), 'utf8')));
      else if (route === '/api/session' && method === 'post') {
        await acquire('session');
        if (config.delayCreate) return late('create', admit);
        if (config.failCreate) return response.destroy();
        await admit(); out({ data: body });
      } else if (url.pathname === '/api/debug/location' && method === 'delete') {
        const directory = url.searchParams.get('location[directory]');
        assert.ok((await readLedger()).some(record => record.intentions.location === directory));
        assert.notEqual(directory, project); assert.notEqual(directory, project2);
        await appendFile(join(root, 'evictions'), directory + '\n'); empty();
      } else if (method === 'get' && parts.length === 4) {
        const session = JSON.parse(await readFile(sessionPath, 'utf8'));
        if (config.wrongIdentity) session.metadata.pstackOwner = 'ses_other';
        out({ data: session });
      } else if (parts[4] === 'prompt' && method === 'post') {
        const record = await acquire('session');
        assert.equal(body.id, record.spec.promptID); assert.match(body.id, /^msg_/);
        if (config.delayPrompt) return late('prompt', () => writeFile(join(root, 'late-prompt'), JSON.stringify(body)));
        out({ data: { id: body.id, sessionID: id } });
      } else if (parts[4] === 'inbox') {
        if (method === 'get') out({ data: [] });
        else { assert.equal(method, 'delete'); assert.match(parts[5], /^msg_/); empty(); }
      } else if (parts[4] === 'interrupt' && method === 'post') {
        assert.equal(url.searchParams.get('resume'), 'false'); assert.equal(body, undefined);
        if (config.secretFailure) { response.statusCode = 400; return out({ message: password, authorization }); }
        if (config.failInterrupt) return response.destroy();
        if (config.invalidInterrupt) return out({});
        if (config.switchOnInterrupt) {
          await writeFile(join(root, 'config.json'), JSON.stringify({ server: config.switchOnInterrupt }));
          return out({ interrupted: false });
        }
        if (config.delayInterrupt) {
          await late('interrupt', async () => { await interrupt(); await appendFile(join(root, 'resumed-cleanup'), id + '\n'); });
          return response.destroy();
        }
        if (config.holdInterrupt) {
          await writeFile(join(root, 'interrupt-held'), id);
          await until(async () => { try { return await readFile(join(root, 'resume-interrupt')); } catch { return false; } });
        }
        await interrupt(); out({ interrupted: !config.idleInterrupt });
      } else if (parts[4] === 'message' && method === 'get') out({ data: [{ id: 'msg_receipt', text: 'retained message' }], cursor: {} });
      else { response.writeHead(404); response.end(); }
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    listener.closeAllConnections();
    await new Promise(resolve => listener.close(resolve));
  });
  await writeFile(registrationFile, JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${listener.address().port}`, password }), { mode: 0o600 });
  await writeFile(join(root, 'server.json'), JSON.stringify({pid:process.pid,version:'fixture',
    urls:[`http://127.0.0.1:${listener.address().port}`],paths:{tmp:root}}));
  const parent = { id: 'ses_parent', location: { directory: project }, model: { providerID: 'parent', id: 'unchanged' },
    permissions: [{ action: 'external-write', resource: '*', effect: 'deny' }, { action: 'sensitive', resource: '*', effect: 'ask' },
      { action: 'parent-allow', resource: '*', effect: 'allow' }], active: true };
  const second = { ...parent, id: 'ses_other', location: { directory: project2 } };
  for (const session of [parent, second]) await writeFile(join(root, 'sessions', session.id), JSON.stringify(session));
  await writeFile(join(bin, 'transport.cjs'), String.raw`#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.dirname(__dirname);
const args = process.argv.slice(2);
const command = path.basename(process.argv[1]);
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const sessionPath = id => path.join(root, 'sessions', id);
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify({ command, args }) + '\n');
function ledger() { return JSON.parse(fs.readFileSync(path.join(root, 'admission', 'ledger.json'), 'utf8')).records; }
function acquired(record, resource) {
  if (!record || record.resources[resource].attempt?.state !== 'outstanding' || !record.plan?.prompt) process.exit(81);
}
if (command === 'git') {
  if (args[0] === 'rev-parse') process.stdout.write('a'.repeat(40) + '\n');
  else if (args[0] === 'clone' || args[0] === 'worktree') {
    const checkout = args[0] === 'clone' ? args.at(-1) : args.at(-2);
    acquired(ledger().find(record => record.intentions.worktree === checkout), 'worktree');
    fs.mkdirSync(checkout);
    fs.writeFileSync(path.join(checkout, 'retained.txt'), 'keep');
    if (config.failBootstrap) fs.mkdirSync(path.join(checkout, '.opencode'));
  } else if (args[0] !== 'checkout') process.exit(82);
} else if (command === 'opencode') {
  if (args[0] !== 'api') process.exit(83);
  const [_, method, route] = args;
  const url = new URL(route, 'http://fixture.invalid');
  const parts = url.pathname.split('/');
  const id = parts[3];
  const out = value => process.stdout.write(JSON.stringify(value));
  if (method === 'get' && parts.length === 4 && ['ses_parent','ses_other','ses_peer'].includes(id)) {
    const session = JSON.parse(fs.readFileSync(sessionPath(id), 'utf8'));
    out({data: session});
  } else if (parts[4] === 'message' && method === 'get') {
    if (config.ambientURL) fetch(new URL(route,config.ambientURL)).then(response => response.json()).then(out).catch(() => process.exitCode = 95);
    else out({data: [{id:'msg_receipt',text:'retained message'}],cursor:{next:undefined}});
  }
  else process.exit(90);
} else if (command === 'docker') {
  const file = id => path.join(root, 'containers', id);
  if (args[0] === 'image') process.stdout.write('[]');
  else if (args[0] === 'run') {
    const name = args[args.indexOf('--name') + 1];
    const record = ledger().find(record => record.intentions.container === name);
    acquired(record, 'container');
    const labels = Object.fromEntries(args.flatMap((value, index) => value === '--label' ? [args[index + 1].split('=')] : []));
    const id = createHash('sha256').update(name).digest('hex');
    fs.writeFileSync(file(id), JSON.stringify({Id:id,Config:{Labels:labels},State:{Running:true,Paused:false,Restarting:false,Status:'running'}}));
    process.stdout.write(id + '\n');
  } else if (args[0] === 'inspect') {
    if (config.failContainerInspect) process.exit(94);
    const id = args[1].startsWith('pstack-') ? createHash('sha256').update(args[1]).digest('hex') : args[1];
    process.stdout.write('[' + fs.readFileSync(file(id), 'utf8') + ']');
  }
  else if (args[0] === 'stop') {
    if (!/^[a-f0-9]{64}$/.test(args.at(-1))) process.exit(91);
    const info = JSON.parse(fs.readFileSync(file(args.at(-1)), 'utf8'));
    info.State.Running = false; info.State.Status = 'exited';
    fs.writeFileSync(file(info.Id), JSON.stringify(info));
  } else process.exit(92);
} else process.exit(93);
`, { mode: 0o755 });
  for (const command of ['opencode', 'git', 'docker']) await symlink('transport.cjs', join(bin, command));
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  const calls = async () => (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const appendCall = value => appendFile(join(root, 'calls'), JSON.stringify(value) + '\n');
  const records = new Map();
  let projectionFailure = false;
  let readFailure = false;
  let onProjection = async () => {};
  const projectionError = new Error('Projection unavailable');
  const storage = { async get(key) { if (readFailure) throw new Error('Projection read unavailable'); return records.get(key); },
    async set(key, value) {
      if (key.includes('/worker/')) await onProjection(value);
      if (projectionFailure && key.includes('/worker/')) throw projectionError;
      records.set(key, structuredClone(value));
    },
    async scan({ prefix, limit = 100, after }) {
      if (readFailure && (prefix === '' || prefix.includes('/worker/'))) throw new Error('Projection scan unavailable');
      const entries = [...records.entries()].map(([key, value]) => ({key, value})).sort((a,b) => a.key.localeCompare(b.key))
        .filter(entry => entry.key.startsWith(prefix) && (!after || entry.key > after));
      return { entries: entries.slice(0, limit), next: entries.length > limit ? entries[limit - 1].key : undefined };
    } };
  const cleanups = [];
  const permissions = [];
  let onPermission = () => {};
  async function install(directory = project, registered = plugin, admission = { directory: join(root, 'admission'), ...options }) {
    const tools = new Map();
    const cleanup = await registered.setup({ location: { directory }, options: { ...(admission ? { admission } : {}), server: { registrationFile } },
      storage, permission: { async hook() {}, async assert(request) { permissions.push(request); await onPermission(request); } }, session: {},
      model: { async list() { return {data: inventory}; } },
      tool: { async transform(edit) { edit({namespace() {}, add(tool) { tools.set(tool.name, tool); }}); } } });
    cleanups.push(cleanup);
    return async (input, owner = 'ses_parent', signal = t.signal) => JSON.parse((await tools.get('worker').execute(input,
      {sessionID: owner, agent:'poteto', messageID:'msg_fixture', id:'tool_fixture', signal})).content);
  }
  const run = await install();
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    process.env.PATH = previousPath;
    for (const record of await readLedger()) await rm(dirname(record.intentions.worktree), { recursive:true, force:true });
    await rm(root, {recursive:true,force:true});
  });
  async function readLedger() {
    try { return JSON.parse(await readFile(join(root, 'admission/ledger.json'), 'utf8')).records; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  return {root, project, project2, parent, second, registrationFile, password, run, install, calls, readLedger, records, permissions,
    start: (extra = {}, owner, signal) => run({action:'start',backend:'local',prompt:'Bounded fixture task',ref:'HEAD',...extra},owner,signal),
    configure: value => writeFile(join(root, 'config.json'),JSON.stringify(value)),
    failProjection() { projectionFailure = true; },
    failReads() { readFailure = true; },
    projectionError,
    onProjection(handler) { onProjection = handler; },
    onRequest(handler) { onRequest = handler; },
    onPermission(handler) { onPermission = handler; },
    close: async () => { for (const cleanup of cleanups) await cleanup(); } };
}

function errorsIn(error) {
  return [error, ...(error?.errors ?? []).flatMap(errorsIn), ...(error?.cause ? errorsIn(error.cause) : [])];
}

function stopper(t, f, id) {
  const child = spawn(process.execPath,['--input-type=module','--eval',`
    import plugin from ${JSON.stringify(new URL('../plugins/pstack/index.js',import.meta.url).href)};
    const tools = new Map();
    const cleanup = await plugin.setup({location:{directory:${JSON.stringify(f.project)}},options:{server:{registrationFile:${JSON.stringify(f.registrationFile)}},admission:{directory:${JSON.stringify(join(f.root,'admission'))},limits:{activeWorkers:1}}},
      storage:{async get(){},async set(){},async scan(){return {entries:[]};}},permission:{async hook(){},async assert(){}},session:{},
      tool:{async transform(edit){edit({namespace(){},add(tool){tools.set(tool.name,tool);}});}}});
    try {
      const output = await tools.get('worker').execute({action:'stop',id:${JSON.stringify(id)}},
        {sessionID:'ses_parent',agent:'poteto',messageID:'msg_child',id:'tool_child',signal:AbortSignal.timeout(10000)});
      console.log(JSON.stringify({result:JSON.parse(output.content)}));
    } catch(error) { console.log(JSON.stringify({error:error.message,cause:error.cause?.code})); }
    finally { await cleanup(); }
  `],{stdio:['ignore','pipe','pipe']});
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stdout = '', stderr = '';
  child.stdout.on('data',data => {stdout += data;});
  child.stderr.on('data',data => {stderr += data;});
  const done = new Promise((resolve,reject) => {
    child.once('error',reject);
    child.once('close',code => { try { assert.equal(code,0,stderr); resolve(JSON.parse(stdout)); } catch(error) { reject(error); } });
  });
  done.catch(() => {});
  return {child,done};
}

async function saturateFailures(f, worker) {
  const admission = new Admission({directory:join(f.root,'admission')});
  for (let index=0;index<32;index++) await admission.update(worker.id,{owner:worker.owner,project:worker.project},{type:'observe',failure:`existing failure ${index}`});
}

test('registry switching during start, status and stop cannot retarget any worker request', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const original = await readFile(f.registrationFile, 'utf8');
  const foreignCalls = [];
  const foreign = createServer((request, response) => { foreignCalls.push(request.url); response.writeHead(500); response.end(); });
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  t.after(async () => { foreign.closeAllConnections(); await new Promise(resolve => foreign.close(resolve)); });
  const replacement = JSON.stringify({ url: `http://127.0.0.1:${foreign.address().port}`, pid: process.pid });
  const switches = [];
  f.onRequest(async (method, route) => {
    if ((method === 'post' && route === '/api/session') || (method === 'get' && /^\/api\/session\/[^/]+$/.test(route)) || (method === 'delete' && route.includes('/inbox/'))) {
      await writeFile(f.registrationFile, replacement); switches.push('B');
    }
    if (route.includes('/prompt') || route.includes('/message') || route.includes('/interrupt') || route.includes('/debug/location')) {
      await writeFile(f.registrationFile, original); switches.push('A');
    }
  });
  const worker = await f.start();
  assert.equal((await f.run({ action: 'status', id: worker.id })).session.data.active, true);
  assert.equal((await f.run({ action: 'stop', id: worker.id })).state, 'stopped');
  assert.ok(switches.filter(value => value === 'B').length >= 3);
  assert.ok(switches.filter(value => value === 'A').length >= 3);
  assert.deepEqual(foreignCalls, []);
  assert.equal((await f.readLedger())[0].plan.server.endpoint, JSON.parse(original).url);
});

test('missing discovery fails before reservation and refuses cleanup without CLI fallback', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const registration = await readFile(f.registrationFile, 'utf8');
  await rm(f.registrationFile);
  await assert.rejects(f.start(), /discovery/);
  assert.deepEqual(await f.readLedger(), []);
  await writeFile(f.registrationFile, registration);
  const worker = await f.start();
  await rm(f.registrationFile);
  const before = (await f.calls()).length;
  assert.equal((await f.run({ action: 'stop', id: worker.id })).state, 'uncertain');
  assert.ok((await f.calls()).slice(before).every(call => call.command === 'opencode' && call.args[2] === '/api/session/ses_parent'));
  await writeFile(f.registrationFile, registration);
  assert.equal((await f.run({ action: 'stop', id: worker.id })).state, 'stopped');
});

test('stopped worker history uses only its configured owning server without reloading the evicted location', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const foreignCalls = [];
  const foreign = createServer((request, response) => {
    foreignCalls.push(request.url);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/api/info' ? { pid: process.pid, version: 'fixture' }
      : { data: [{ text: 'wrong server history' }], cursor: {} }));
  });
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
  t.after(async () => { foreign.closeAllConnections(); await new Promise(resolve => foreign.close(resolve)); });
  const worker = await f.start();
  assert.equal((await f.run({ action: 'stop', id: worker.id })).state, 'stopped');
  await f.configure({ ambientURL: `http://127.0.0.1:${foreign.address().port}` });
  const before = (await f.calls()).length;
  const page = await f.run({ action: 'messages', id: worker.id, limit: 1, cursor: 'opaque+/cursor' });
  assert.equal(page.data[0].text, 'retained message');
  assert.deepEqual(foreignCalls, []);
  const calls = (await f.calls()).slice(before);
  const history = calls.filter(call => call.args[2]?.includes(`/api/session/${worker.sessionID}`));
  assert.equal(history.length, 1);
  assert.equal(history[0].command, 'http');
  const url = new URL(history[0].args[2], 'http://fixture');
  assert.equal(url.pathname, `/api/session/${worker.sessionID}/message`);
  assert.equal(url.searchParams.get('cursor'), 'opaque+/cursor');
  assert.equal(url.searchParams.get('limit'), '1');
  assert.ok(calls.every(call => call.args[2] === '/api/session/ses_parent' || call.args[2] === '/api/info' || call === history[0]));
  const original = await readFile(f.registrationFile, 'utf8');
  await writeFile(f.registrationFile, JSON.stringify({ url: `http://127.0.0.1:${foreign.address().port}`, pid: process.pid }));
  await assert.rejects(f.run({ action: 'messages', id: worker.id }));
  assert.deepEqual(foreignCalls, ['/api/info']);
  await writeFile(f.registrationFile, original);
  assert.equal((await f.readLedger())[0].state, 'stopped');
});

test('stop refuses a changed endpoint even when both listeners share the same PID, boot and start identity', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const original = await readFile(f.registrationFile, 'utf8');
  const calls = [];
  let info;
  const alternate = createServer((request, response) => {
    calls.push(request.url);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(info));
  });
  await new Promise(resolve => alternate.listen(0, '127.0.0.1', resolve));
  t.after(async () => { alternate.closeAllConnections(); await new Promise(resolve => alternate.close(resolve)); });
  const endpoint = `http://127.0.0.1:${alternate.address().port}`;
  info = { ...JSON.parse(await readFile(join(f.root, 'server.json'), 'utf8')), urls: [JSON.parse(original).url, endpoint] };
  await f.configure({ server: info });
  const worker = await f.start();
  await writeFile(f.registrationFile, JSON.stringify({ url: endpoint, pid: process.pid }));
  const stopped = await f.run({ action: 'stop', id: worker.id });
  assert.equal(stopped.state, 'uncertain');
  assert.ok(stopped.cleanupErrors.some(error => error.includes('server instance mismatch')));
  assert.deepEqual(calls, ['/api/info']);
  assert.equal(JSON.parse(await readFile(join(f.root, 'sessions', worker.sessionID), 'utf8')).active, true);
  await writeFile(f.registrationFile, original);
  assert.equal((await f.run({ action: 'stop', id: worker.id })).state, 'stopped');
});

test('service authentication stays out of worker metadata, projections, ledgers and cleanup errors', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const worker = await f.start();
  await f.configure({ secretFailure: true });
  const stopped = await f.run({ action: 'stop', id: worker.id });
  assert.equal(stopped.state, 'uncertain');
  assert.equal(stopped.cleanup.requests.length, 1);
  const authorization = Buffer.from(`opencode:${f.password}`).toString('base64');
  for (const value of [worker, stopped, [...f.records.values()], await f.readLedger(),
    JSON.parse(await readFile(join(f.root, 'sessions', worker.sessionID), 'utf8'))]) {
    assert.ok(!JSON.stringify(value).includes(f.password));
    assert.ok(!JSON.stringify(value).includes(authorization));
  }
});

test('separate registered stoppers fence a delayed cleanup producer until its last request completes', {timeout:15000}, async t => {
  const f = await fixture(t,{limits:{activeWorkers:1}});
  const worker = await f.start();
  await f.configure({holdInterrupt:true});
  const first = stopper(t,f,worker.id);
  await until(async () => { try { return await readFile(join(f.root,'interrupt-held'),'utf8'); } catch { return false; } });
  const before = (await f.calls()).filter(call => call.args[2] !== '/api/session/ses_parent').length;
  const second = await stopper(t,f,worker.id).done;
  assert.equal(second.cause,'CLEANUP_OUTSTANDING');
  assert.equal((await f.calls()).filter(call => call.args[2] !== '/api/session/ses_parent').length,before);
  await assert.rejects(f.start(),error => error.code === 'CAPACITY');
  await writeFile(join(f.root,'resume-interrupt'),'resume');
  assert.equal((await first.done).result.state,'stopped');
  const count = (await f.calls()).filter(call => call.args[2] !== '/api/session/ses_parent').length;
  assert.equal((await stopper(t,f,worker.id).done).result.state,'stopped');
  assert.equal((await f.calls()).filter(call => call.args[2] !== '/api/session/ses_parent').length,count);
});

for (const heldRoute of ['session', 'messages']) {
  test(`a held status ${heldRoute} read fences stop and eviction until the reader drains`, { timeout: 10000 }, async t => {
    const f = await fixture(t, { limits: { activeWorkers: 1 } });
    const worker = await f.start();
    let entered;
    const dispatched = new Promise(resolve => { entered = resolve; });
    let resume;
    const held = new Promise(resolve => { resume = resolve; });
    t.after(() => resume());
    const path = `/api/session/${worker.sessionID}` + (heldRoute === 'messages' ? '/message' : '');
    let waiting = true;
    f.onRequest(async (method, route) => {
      if (waiting && method === 'get' && route.split('?')[0] === path) {
        waiting = false;
        entered();
        await held;
      }
    });
    const reading = f.run({ action: 'status', id: worker.id });
    await dispatched;
    const before = (await f.calls()).length;
    const blocked = await stopper(t, f, worker.id).done;
    assert.equal(blocked.cause, 'CLEANUP_OUTSTANDING');
    assert.ok((await f.calls()).slice(before).every(call => call.args[2] === '/api/session/ses_parent'));
    assert.ok(!(await readdir(f.root)).includes('evictions'));
    await assert.rejects(f.start(), error => error.code === 'CAPACITY');
    resume();
    assert.equal((await reading).session.data.active, true);
    assert.equal((await f.run({ action: 'stop', id: worker.id })).state, 'stopped');
    const after = (await f.calls()).length;
    assert.equal((await f.run({ action: 'status', id: worker.id })).state, 'stopped');
    assert.ok((await f.calls()).slice(after).every(call => call.args[2] === '/api/session/ses_parent'));
    assert.equal((await readFile(join(f.root, 'evictions'), 'utf8')).trim(), worker.directory);
  });
}

test('a remote interrupt resuming after its HTTP connection fails remains outstanding across stopper processes and retries', {timeout:15000}, async t => {
  const f = await fixture(t,{limits:{activeWorkers:1}});
  const worker = await f.start();
  await f.configure({delayInterrupt:true});
  const stopping = stopper(t,f,worker.id);
  await until(async () => { try { return JSON.parse(await readFile(join(f.root,'dispatched'),'utf8')); } catch { return false; } });
  const result = await stopping.done;
  assert.equal(result.result.state,'uncertain');
  assert.equal(result.result.cleanup.producer,null);
  assert.equal(result.result.cleanup.requests.length,1);
  await until(async () => { try { return await readFile(join(f.root,'resumed-cleanup'),'utf8'); } catch { return false; } });
  await f.configure({});
  const before = (await f.calls()).filter(call => call.args[2] !== '/api/session/ses_parent').length;
  assert.equal((await stopper(t,f,worker.id).done).cause,'CLEANUP_OUTSTANDING');
  assert.equal((await f.calls()).filter(call => call.args[2] !== '/api/session/ses_parent').length,before);
  assert.equal((await f.readLedger())[0].cleanup.requests.length,1);
  assert.ok(!(await f.calls()).some(call => call.args[2]?.startsWith('/api/debug/location')));
  await assert.rejects(f.start(),error => error.code === 'CAPACITY');
});

test('wrong-server idle interruption cannot certify the originating worker while a bound idle response is legitimate', async t => {
  const f = await fixture(t,{limits:{activeWorkers:1}});
  const worker = await f.start();
  const original = await readFile(f.registrationFile, 'utf8');
  const replacement = spawn(process.execPath,['--input-type=module','--eval',`
    import {createServer} from 'node:http';
    let info;
    const listener = createServer((request,response) => { response.setHeader('content-type','application/json'); response.end(JSON.stringify(info)); });
    listener.listen(0,'127.0.0.1',() => { info = {pid:process.pid,version:'fixture',urls:['http://127.0.0.1:'+listener.address().port],paths:{tmp:${JSON.stringify(f.root)}}}; console.log(JSON.stringify(info)); });
  `],{stdio:['ignore','pipe','pipe']});
  t.after(() => replacement.kill('SIGKILL'));
  const server = await new Promise((resolve,reject) => { replacement.once('error',reject); replacement.stdout.once('data',data => resolve(JSON.parse(String(data)))); });
  await writeFile(f.registrationFile, JSON.stringify({ pid: server.pid, url: server.urls[0] }));
  await f.configure({idleInterrupt:true});
  await assert.rejects(f.run({action:'status',id:worker.id}),new RegExp(worker.id));
  assert.equal((await f.run({action:'stop',id:worker.id})).state,'uncertain');
  assert.ok(!(await f.calls()).some(call => /interrupt|debug\/location/.test(call.args[2])));
  assert.equal(JSON.parse(await readFile(join(f.root,'sessions',worker.sessionID),'utf8')).active,true);
  await assert.rejects(f.start(),error => error.code === 'CAPACITY');
  await writeFile(f.registrationFile, original);
  await f.configure({idleInterrupt:true});
  assert.equal((await f.run({action:'stop',id:worker.id})).state,'stopped');
});

test('a false interrupt response followed by changed server identity cannot certify or retire the remote cleanup request', async t => {
  const f = await fixture(t,{limits:{activeWorkers:1}});
  const worker = await f.start();
  await f.configure({switchOnInterrupt:{pid:0,version:'replacement',urls:[],paths:{tmp:f.root}}});
  const stopped = await f.run({action:'stop',id:worker.id});
  assert.equal(stopped.state,'uncertain');
  assert.equal(stopped.cleanup.requests.length,1);
  assert.match(stopped.cleanup.requests[0].operation,/interrupt/);
  assert.equal(JSON.parse(await readFile(join(f.root,'sessions',worker.sessionID),'utf8')).active,true);
  await f.configure({});
  const before = (await f.calls()).length;
  await assert.rejects(f.run({action:'stop',id:worker.id}),new RegExp(worker.id));
  assert.ok((await f.calls()).slice(before).every(call => call.args[2] === '/api/session/ses_parent'));
  await assert.rejects(f.start(),error => error.code === 'CAPACITY');
});

test('an unconfirmed interrupt response stays charged even when a later retry could report idle', async t => {
  const f = await fixture(t,{limits:{activeWorkers:1}});
  const worker = await f.start();
  await f.configure({invalidInterrupt:true});
  const stopped = await f.run({action:'stop',id:worker.id});
  assert.equal(stopped.state,'uncertain');
  assert.equal(stopped.cleanup.requests.length,1);
  await f.configure({idleInterrupt:true});
  const before = (await f.calls()).length;
  await assert.rejects(f.run({action:'stop',id:worker.id}),new RegExp(worker.id));
  assert.ok((await f.calls()).slice(before).every(call => call.args[2] === '/api/session/ses_parent'));
  await assert.rejects(f.start(),error => error.code === 'CAPACITY');
});

for (const field of ['start','boot']) {
  test(`the same numeric PID cannot certify a persisted worker from a different OS ${field} identity`, async t => {
    const f = await fixture(t,{limits:{activeWorkers:1}});
    const worker = await f.start();
    const [record] = await f.readLedger();
    assert.equal(record.plan.server.pid,process.pid);
    const metadata = JSON.parse(await readFile(join(f.root,'sessions',worker.sessionID),'utf8'));
    assert.deepEqual(metadata.metadata.pstackServer,record.plan.server);
    const ledgerPath = join(f.root,'admission/ledger.json');
    const ledger = JSON.parse(await readFile(ledgerPath,'utf8'));
    ledger.records[0].plan.server[field] = field === 'start' ? String(BigInt(record.plan.server.start)+1n) : '00000000-0000-4000-8000-000000000000';
    metadata.metadata.pstackServer = ledger.records[0].plan.server;
    await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
    await writeFile(join(f.root,'sessions',worker.sessionID),JSON.stringify(metadata));
    const stopped = await f.run({action:'stop',id:worker.id});
    assert.equal(stopped.state,'uncertain');
    assert.ok(stopped.cleanupErrors.some(error => error.includes('server instance mismatch')));
    assert.ok(!(await f.calls()).some(call => /interrupt|debug\/location/.test(call.args[2])));
    await assert.rejects(f.start(),error => error.code === 'CAPACITY');
  });
}

test('degraded registered discovery pages the authoritative ledger without projection reads or writes and never exposes foreign workers', async t => {
  const f = await fixture(t,{limits:{activeWorkers:8}});
  await writeFile(join(f.root,'sessions/ses_peer'),JSON.stringify({...f.parent,id:'ses_peer'}));
  const other = await f.install(f.project2);
  const own = [await f.start(),await f.start(),await f.start()];
  const foreign = [await f.start({},'ses_peer'),await other({action:'start',backend:'local',prompt:'Other project',ref:'HEAD'},'ses_other')];
  f.failProjection(); f.failReads();
  const reloaded = await f.install();
  const ids = [];
  let cursor;
  do {
    const page = await (cursor ? reloaded : f.run)({action:'list',limit:1,...(cursor ? {cursor} : {})});
    assert.match(page.warnings.join(' '),/ledger-only.*incomplete legacy coverage/);
    ids.push(...page.workers.map(worker => worker.id));
    if (page.next) {
      for (const worker of foreign) assert.ok(!Buffer.from(page.next,'base64url').toString('utf8').includes(worker.id));
      await assert.rejects(f.run({action:'list',limit:1,cursor:page.next},'ses_peer'),/Invalid worker cursor/);
    }
    cursor = page.next;
  } while(cursor);
  assert.deepEqual(ids.sort(),own.map(worker => worker.id).sort());
  const ledgerPath = join(f.root,'admission/ledger.json');
  const ledgerBytes = await readFile(ledgerPath);
  try {
    await writeFile(ledgerPath,'{');
    await assert.rejects(f.run({action:'list'}),error => error.code === 'CORRUPT_LEDGER');
  } finally { await writeFile(ledgerPath,ledgerBytes); }
});

test('projection and observation failures preserve the original exception and reserved worker ID', async t => {
  const f = await fixture(t);
  f.failProjection();
  f.onProjection(worker => saturateFailures(f,worker));
  await assert.rejects(f.start(),asyncError => {
    const errors = errorsIn(asyncError);
    assert.ok(errors.includes(f.projectionError));
    assert.ok(errors.some(error => error.code === 'RETENTION'));
    assert.match(asyncError.message,/Worker [a-f0-9-]{36} failed/);
    assert.ok(asyncError.cause);
    return true;
  });
});

test('cleanup plus failed bookkeeping aggregates both failures without replacing the interrupted request error', async t => {
  const f = await fixture(t);
  const worker = await f.start();
  await saturateFailures(f,worker);
  await f.configure({failInterrupt:true});
  await assert.rejects(f.run({action:'stop',id:worker.id}),error => {
    const errors = errorsIn(error);
    assert.match(error.message,new RegExp(worker.id));
    assert.ok(error.cause);
    assert.ok(errors.some(error => error.message?.includes('Pinned worker server request failed')));
    assert.ok(errors.some(error => error.code === 'RETENTION'));
    return true;
  });
  assert.notEqual((await f.readLedger())[0].state,'stopped');
});

test('two concurrent owners and locations share two slots; a third acquires no resources', {timeout:15000}, async t => {
  const f = await fixture(t);
  const other = await f.install(f.project2);
  const [first, second] = await Promise.all([f.start(), other({action:'start',backend:'local',prompt:'Second owner',ref:'HEAD'},'ses_other')]);
  await assert.rejects(f.start(), error => error.code === 'CAPACITY');
  assert.equal((await f.calls()).filter(call => call.command === 'git' && call.args[0] === 'worktree').length,2);
  assert.equal((await f.readLedger()).length,2);
  assert.deepEqual((await f.run({action:'list'})).workers.map(worker => worker.id),[first.id]);
  assert.deepEqual((await other({action:'list'},'ses_other')).workers.map(worker => worker.id),[second.id]);
  await assert.rejects(f.run({action:'stop',id:second.id}));
  await assert.rejects(other({action:'status',id:first.id},'ses_other'));
  assert.equal((await f.run({action:'status',id:first.id})).session.data.active,true);
});

test('registered worker pagination preserves empty owner-filtered pages and rejects cross-owner cursors', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root,'sessions/ses_peer'),JSON.stringify({...f.parent,id:'ses_peer'}));
  const workers = [await f.start(),await f.start({},'ses_peer')].sort((a,b) => a.id.localeCompare(b.id));
  const owner = workers[1].owner;
  const first = await f.run({action:'list',limit:1},owner);
  assert.deepEqual(first.workers,[]);
  assert.ok(first.next);
  const second = await f.run({action:'list',limit:1,cursor:first.next},owner);
  assert.deepEqual(second.workers.map(worker => worker.id),[workers[1].id]);
  await assert.rejects(f.run({action:'list',limit:1,cursor:first.next},workers[0].owner),/Invalid worker cursor/);
});

test('normal local and container stops release capacity, retain files/history, and never reload stopped locations', {timeout:15000}, async t => {
  const f = await fixture(t, {limits:{activeWorkers:1}});
  for (const backend of ['local','container','local']) {
    const worker = await f.start({backend});
    assert.match(worker.sessionID,/^ses_[a-zA-Z0-9]+$/);
    assert.deepEqual(worker.model,model);
    const stopped = await f.run({action:'stop',id:worker.id});
    assert.equal(stopped.state,'stopped');
    assert.equal(stopped.resources.location.state,'retained');
    assert.equal(stopped.resources.worktree.state,'retained');
    assert.equal(await readFile(join(worker.directory,'retained.txt'),'utf8'),'keep');
    const before = (await f.calls()).length;
    assert.equal((await f.run({action:'stop',id:worker.id})).state,'stopped');
    assert.equal((await f.run({action:'status',id:worker.id})).state,'stopped');
    const newCalls = (await f.calls()).slice(before);
    assert.ok(newCalls.every(call => call.command === 'opencode' && call.args[2] === '/api/session/ses_parent'));
    const messages = await f.run({action:'messages',id:worker.id,limit:1});
    assert.equal(messages.data[0].text,'retained message');
    assert.ok((await f.calls()).slice(before).every(call => call.args[2] === '/api/session/ses_parent' || call.args[2] === '/api/info' ||
      call.args[1] === 'get' && call.args[2] === `/api/session/${worker.sessionID}/message?limit=1`),'Only parent scope and middleware-free history reads may run after eviction');
    if (backend === 'container') {
      assert.match(stopped.containerID,/^[a-f0-9]{64}$/);
      const stop = (await f.calls()).findLast(call => call.command === 'docker' && call.args[0] === 'stop');
      assert.equal(stop.args.at(-1),worker.containerID);
    }
  }
  assert.equal((await readFile(join(f.root,'evictions'),'utf8')).trim().split('\n').length,3);
  assert.deepEqual(JSON.parse(await readFile(join(f.root,'sessions/ses_parent'),'utf8')),f.parent);
  const page = await f.run({action:'list',limit:1});
  assert.equal(page.workers.length,1);
  assert.ok(page.next);
  const page2 = await f.run({action:'list',limit:1,cursor:page.next});
  assert.notEqual(page2.workers[0].id,page.workers[0].id);
});

test('a failed projection leaves the owner a discoverable failed start with immutable execution inputs', async t => {
  const f = await fixture(t);
  f.failProjection();
  await assert.rejects(f.start(),/Worker .* failed/);
  const [worker] = (await f.run({action:'list'})).workers;
  assert.equal(worker.state,'uncertain');
  assert.equal(worker.observed.projection,'failed');
  assert.equal([...f.records.keys()].filter(key => key.includes('/worker/')).length,0);
  assert.equal((await f.run({action:'status',id:worker.id})).state,'uncertain');
  const [record] = await f.readLedger();
  assert.equal(record.plan.prompt.endsWith('Bounded fixture task'),true);
  assert.ok(record.plan.permissions.some(rule => rule.action === 'external-write' && rule.effect === 'deny'));
  assert.ok(!record.plan.permissions.some(rule => rule.action === 'parent-allow'));
  const ledger = new Admission({directory:join(f.root,'admission')});
  const {state,resources,observed,...identity} = record;
  await assert.rejects(ledger.reserve({...identity,plan:{...identity.plan,prompt:'replacement'}}),error => error.code === 'IDENTITY_MISMATCH');
  await assert.rejects(ledger.reserve({...identity,plan:{...identity.plan,permissions:[]}}),error => error.code === 'IDENTITY_MISMATCH');
  for (const plan of [{...identity.plan,prompt:'x'.repeat(20001)}, {...identity.plan,extra:true},
    {...identity.plan,permissions:[{action:'*',resource:'*',effect:'unknown'}]},
    {...identity.plan,permissions:Array(1001).fill({action:'*',resource:'*',effect:'deny'})}]) {
    await assert.rejects(ledger.reserve({...identity,plan}),error => error.code === 'INVALID_INPUT');
  }
  await assert.rejects(ledger.update(record.id,{owner:record.owner,project:record.project},{type:'observe',containerID:'not-an-id'}));
  await assert.rejects(f.run({action:'stop',id:worker.id}),/Worker .* stop failed/);
  assert.equal((await f.run({action:'status',id:worker.id})).state,'stopped');
});

for (const type of ['Create','Prompt']) {
  test(`aborted remote ${type.toLowerCase()} can finish later without freeing its outstanding slot or retrying`, {timeout:15000}, async t => {
    const f = await fixture(t,{limits:{activeWorkers:1}});
    await f.configure({['delay'+type]:true});
    const abort = new AbortController();
    const pending = f.start({},undefined,abort.signal);
    const rejected = assert.rejects(pending,/Worker .* failed/);
    await until(async () => { try { return await readFile(join(f.root,'dispatched'),'utf8'); } catch { return false; } });
    const [worker] = (await f.run({action:'list'})).workers;
    const stopping = type === 'Prompt' ? f.run({action:'stop',id:worker.id}) : undefined;
    if (type === 'Create') abort.abort();
    await rejected;
    const stopped = await (stopping ?? f.run({action:'stop',id:worker.id}));
    assert.equal(stopped.state,'uncertain');
    assert.equal(stopped.resources.session.attempt.state,'outstanding');
    await until(async () => { try { return await readFile(join(f.root,'late-settled'),'utf8'); } catch { return false; } });
    if (type === 'Create') assert.equal(JSON.parse(await readFile(join(f.root,'sessions',worker.sessionID),'utf8')).id,worker.sessionID);
    else assert.match(await readFile(join(f.root,'late-prompt'),'utf8'),/Bounded fixture task/);
    try { assert.equal((await f.run({action:'stop',id:worker.id})).state,'uncertain'); }
    catch (error) { assert.match(error.message,new RegExp(`Worker ${worker.id} stop failed`)); }
    await f.configure({});
    await assert.rejects(f.start(),error => error.code === 'CAPACITY');
    const calls = await f.calls();
    assert.equal(calls.filter(call => call.args[1] === 'post' && call.args[2] === '/api/session').length,1);
    assert.equal(calls.filter(call => call.args[1] === 'post' && /\/prompt$/.test(call.args[2])).length,type === 'Prompt' ? 1 : 0);
    assert.ok(!calls.some(call => call.args[2]?.startsWith('/api/debug/location')));
    assert.equal((await f.readLedger())[0].resources.session.attempt.state,'outstanding');
  });
}

test('ambiguous session cleanup failure still stops the container but a retry cannot clear its remote request', async t => {
  const f = await fixture(t);
  const worker = await f.start({backend:'container'});
  await f.configure({failInterrupt:true});
  const failed = await f.run({action:'stop',id:worker.id});
  assert.equal(failed.state,'uncertain');
  assert.ok(failed.cleanupErrors.length);
  assert.ok((await f.calls()).some(call => call.command === 'docker' && call.args[0] === 'stop' && call.args.at(-1) === worker.containerID));
  await f.configure({});
  await assert.rejects(f.run({action:'stop',id:worker.id}),/Worker .* stop failed/);
  assert.equal((await f.run({action:'status',id:worker.id})).state,'uncertain');
  assert.ok((await f.run({action:'status',id:worker.id})).observed.failures.length);
});

test('session metadata mismatch prevents interrupt and eviction but still stops the owned container', async t => {
  const f = await fixture(t);
  const worker = await f.start({backend:'container'});
  await f.configure({wrongIdentity:true});
  const stopped = await f.run({action:'stop',id:worker.id});
  assert.equal(stopped.state,'uncertain');
  const calls = await f.calls();
  assert.ok(!calls.some(call => /interrupt|debug\/location/.test(call.args[2])));
  assert.ok(calls.some(call => call.command === 'docker' && call.args[0] === 'stop'));
});

test('owned container discovery after a failed startup inspection records its stable ID without retiring the creator token', async t => {
  const f = await fixture(t,{limits:{activeWorkers:1}});
  await f.configure({failContainerInspect:true});
  await assert.rejects(f.start({backend:'container'}),/Worker .* failed/);
  const [worker] = (await f.run({action:'list'})).workers;
  assert.equal(worker.observed.containerID,null);
  assert.equal(worker.resources.container.attempt.state,'outstanding');
  await f.configure({});
  const stopped = await f.run({action:'stop',id:worker.id});
  assert.equal(stopped.state,'uncertain');
  assert.match(stopped.observed.containerID,/^[a-f0-9]{64}$/);
  assert.equal(stopped.resources.container.attempt.state,'outstanding');
  const calls = await f.calls();
  assert.ok(calls.some(call => call.command === 'docker' && call.args[0] === 'stop' && call.args.at(-1) === stopped.observed.containerID));
  await assert.rejects(f.start(),error => error.code === 'CAPACITY');
  const record = (await f.readLedger())[0];
  const admission = new Admission({directory:join(f.root,'admission'),limits:{activeWorkers:1}});
  await assert.rejects(admission.update(record.id,{owner:record.owner,project:record.project},
    {type:'observe',containerID:'f'.repeat(64)}),error => error.code === 'INVALID_TRANSITION');
});

test('legacy worker projections block rollout before acquisitions and remain visible without automatic cleanup', async t => {
  const f = await fixture(t);
  const id = randomUUID();
  const prefix = createHash('sha256').update(f.project).digest('hex').slice(0,24);
  f.records.set(`${prefix}/worker/${id}`,{id,owner:'ses_parent',sessionID:'ses_old',directory:join(f.root,'old'),backend:'local'});
  await assert.rejects(f.start(),/explicit reconciliation/);
  assert.equal((await f.run({action:'list'})).workers[0].reconciliationRequired,true);
  assert.equal((await f.run({action:'status',id})).reconciliationRequired,true);
  assert.equal((await f.run({action:'stop',id})).reconciliationRequired,true);
  assert.ok((await f.calls()).every(call => call.command === 'opencode' && call.args[1] === 'get' && call.args[2] === '/api/session/ses_parent'));
});

test('an admission directory symlink cannot redirect ledger writes', async t => {
  const f = await fixture(t);
  const target = join(f.root,'untouched');
  await mkdir(target);
  await symlink(target,join(f.root,'admission'));
  await assert.rejects(f.start(),/Unsafe directory alias/);
  assert.deepEqual(await readdir(target),[]);
  assert.equal((await lstat(join(f.root,'admission'))).isSymbolicLink(),true);
});

test('permission-time cancellation creates neither a reservation nor worker resources', async t => {
  const f = await fixture(t);
  const abort = new AbortController();
  f.onPermission(request => { if (request.action === 'subagent') abort.abort(); });
  await assert.rejects(f.start({},undefined,abort.signal),error => error.name === 'AbortError');
  assert.deepEqual(await f.readLedger(),[]);
  assert.ok(!(await f.calls()).some(call => call.command === 'git' || call.command === 'docker'));
});

test('a failure before session creation remains owner-discoverable without a projection', async t => {
  const f = await fixture(t,{limits:{activeWorkers:1}});
  await f.configure({failBootstrap:true});
  await assert.rejects(f.start(),/Worker .* failed/);
  const [worker] = (await f.run({action:'list'})).workers;
  assert.equal(worker.state,'uncertain');
  assert.equal(worker.resources.session.attempt,null);
  assert.equal(worker.resources.location.attempt.state,'outstanding');
  assert.ok(!(await f.calls()).some(call => call.args[1] === 'post' && call.args[2] === '/api/session'));
  const before = (await f.calls()).length;
  assert.equal((await f.run({action:'status',id:worker.id})).state,'uncertain');
  assert.equal((await f.run({action:'stop',id:worker.id})).state,'uncertain');
  assert.ok((await f.calls()).slice(before).every(call => call.args[2] === '/api/session/ses_parent'));
  await assert.rejects(f.start(),error => error.code === 'CAPACITY');
});

test('unload aborts an admitted startup with durable unresolved state rather than releasing its slot', {timeout:15000}, async t => {
  const f = await fixture(t,{limits:{activeWorkers:1}});
  await f.configure({delayCreate:true});
  const pending = assert.rejects(f.start(),/Worker .* failed/);
  await until(async () => { try { return await readFile(join(f.root,'dispatched'),'utf8'); } catch { return false; } });
  await f.close();
  await pending;
  const [record] = await f.readLedger();
  assert.equal(record.state,'uncertain');
  assert.equal(record.resources.session.attempt.state,'outstanding');
  await assert.rejects(f.start(),/unloaded/);
  await until(async () => { try { return await readFile(join(f.root,'late-settled'),'utf8'); } catch { return false; } });
  const reloaded = await f.install();
  assert.equal((await reloaded({action:'list'})).workers[0].id,record.id);
  await f.configure({});
  await assert.rejects(reloaded({action:'start',backend:'local',prompt:'No extra slot',ref:'HEAD'}),error => error.code === 'CAPACITY');
});

test('the default ledger is lazy and belongs to the installed bundle, not a global directory', async t => {
  const f = await fixture(t);
  const bundle = join(f.root,'bundle');
  await mkdir(bundle);
  await cp(join(source,'plugins'),join(bundle,'plugins'),{recursive:true});
  await cp(join(source,'package.json'),join(bundle,'package.json'));
  await symlink(join(source,'node_modules'),join(bundle,'node_modules'),'dir');
  const installed = (await import(pathToFileURL(join(bundle,'plugins/pstack/index.js')).href)).default;
  const run = await f.install(f.project,installed,null);
  await assert.rejects(lstat(join(bundle,'.pstack-state')),error => error.code === 'ENOENT');
  assert.deepEqual((await run({action:'list'})).workers,[]);
  const path = join(bundle,'.pstack-state/admission/ledger.json');
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')).limits,{activeWorkers:2,retainedRecords:100});
  assert.deepEqual((await run({action:'list'})).workers,[]);
});
