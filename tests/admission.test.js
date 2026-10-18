import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, link, unlink, utimes, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Admission, AdmissionError } from '../plugins/pstack/admission.js';

const moduleURL = new URL('../plugins/pstack/admission.js', import.meta.url).href;
const ownerScope = { owner: 'owner-a', project: '/projects/a' };
const executionSpec = { role: 'poteto-agent', task: 'implementation', model: 'provider/model#variant', ref: 'a'.repeat(40), promptID: 'prompt-a' };
const request = (id = 'worker-a', extra = {}) => ({ id, ...ownerScope, backend: 'local',
  spec: { ...executionSpec }, intentions: { location: `/locations/${id}`, worktree: `/worktrees/${id}`, session: `ses_${id.replace(/[^a-zA-Z0-9]/g, '')}` }, ...extra });
const errorCode = code => error => error instanceof AdmissionError && error.code === code;

test('local workers track host services and retained files separately at the same checkout', async t => {
  const admission = new Admission({ directory: await directory(t) });
  const planned = request();
  planned.intentions.location = planned.intentions.worktree;
  const reserved = await admission.reserve(planned);
  assert.equal(reserved.intentions.location, reserved.intentions.worktree);
  await createResource(admission, planned.id, 'location');
  await createResource(admission, planned.id, 'worktree');
  await admission.update(planned.id, ownerScope, { type: 'stop' });
  await admission.update(planned.id, ownerScope, { type: 'verify', resource: 'worktree', state: 'retained', evidence: 'Checkout retained after creator settled' });
  await admission.update(planned.id, ownerScope, { type: 'verify', resource: 'session', state: 'absent', evidence: 'Session creation never attempted' });
  await assert.rejects(admission.release(planned.id, ownerScope));
  await admission.update(planned.id, ownerScope, { type: 'verify', resource: 'location', state: 'retained', evidence: 'Host location evicted; checkout retained' });
  assert.equal((await admission.release(planned.id, ownerScope)).state, 'stopped');
});

async function directory(t) {
  const path = await mkdtemp('/tmp/opencode/admission-');
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function retryLocked(operation) {
  for (let attempt = 0; attempt < 500; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (error.code !== 'LOCKED') throw error;
      await delay(2);
    }
  }
  assert.fail('bounded lock retries exhausted');
}

async function stopUnused(admission, id = 'worker-a', scope = ownerScope) {
  await admission.update(id, scope, { type: 'stop' });
  await admission.update(id, scope, { type: 'verify', resource: 'location', state: 'absent', evidence: 'Location creation was never attempted' });
  await admission.update(id, scope, { type: 'verify', resource: 'worktree', state: 'absent', evidence: 'Creation was never attempted' });
  await admission.update(id, scope, { type: 'verify', resource: 'session', state: 'absent', evidence: 'Creation was never attempted' });
  return admission.release(id, scope);
}

async function createResource(admission, id, resource) {
  const { completionToken } = await admission.update(id, ownerScope, { type: 'acquire', resource });
  assert.equal(typeof completionToken, 'string');
  return admission.update(id, ownerScope, { type: 'complete', resource, completionToken, outcome: 'present' });
}

test('cleanup leases exclusively fence external producers and retain unresolved requests across handles', async t => {
  const path = await directory(t);
  const admission = new Admission({directory:path,limits:{activeWorkers:1}});
  await admission.reserve(request());
  const lease = await admission.update('worker-a',ownerScope,{type:'access',kind:'stop'});
  assert.equal(typeof lease.completionToken,'string');
  const remote = await admission.update('worker-a',ownerScope,{type:'request',completionToken:lease.completionToken,operation:'interrupt'});
  const retry = new Admission({directory:path,limits:{activeWorkers:1}});
  await assert.rejects(retry.update('worker-a',ownerScope,{type:'access',kind:'stop'}),errorCode('CLEANUP_OUTSTANDING'));
  await assert.rejects(retry.update('worker-a',ownerScope,{type:'verify',resource:'session',state:'absent',evidence:'Absent now'}),errorCode('CLEANUP_OUTSTANDING'));
  await admission.update('worker-a',ownerScope,{type:'end-access',completionToken:lease.completionToken});
  await assert.rejects(retry.update('worker-a',ownerScope,{type:'access',kind:'stop'}),errorCode('CLEANUP_OUTSTANDING'));
  await assert.rejects(retry.update('worker-a',ownerScope,{type:'settle-request',completionToken:lease.completionToken,requestToken:remote.completionToken}),errorCode('INVALID_COMPLETION'));
  await assert.rejects(retry.release('worker-a',ownerScope),errorCode('INVALID_TRANSITION'));
  await assert.rejects(retry.reserve(request('worker-b')),errorCode('CAPACITY'));
  assert.deepEqual((await retry.get('worker-a',ownerScope)).cleanup.requests.map(request => request.operation),['interrupt']);
});

test('confirmed eviction permanently fences new external requests even before final release', async t => {
  const admission = new Admission({directory:await directory(t)});
  await admission.reserve(request());
  const lease = await admission.update('worker-a',ownerScope,{type:'access',kind:'stop'});
  const remote = await admission.update('worker-a',ownerScope,{type:'request',completionToken:lease.completionToken,operation:'evict'});
  await admission.update('worker-a',ownerScope,{type:'settle-request',completionToken:lease.completionToken,requestToken:remote.completionToken,evicted:true});
  await assert.rejects(admission.update('worker-a',ownerScope,{type:'request',completionToken:lease.completionToken,operation:'interrupt after eviction'}),errorCode('INVALID_TRANSITION'));
  await admission.update('worker-a',ownerScope,{type:'end-access',completionToken:lease.completionToken});
  const retry = await admission.update('worker-a',ownerScope,{type:'access',kind:'stop'});
  await assert.rejects(admission.update('worker-a',ownerScope,{type:'request',completionToken:retry.completionToken,operation:'read after eviction'}),errorCode('INVALID_TRANSITION'));
  await admission.update('worker-a',ownerScope,{type:'end-access',completionToken:retry.completionToken});
  assert.equal((await stopUnused(admission)).state,'stopped');
});

function child(t, executable, args) {
  const process = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => { if (process.exitCode === null) process.kill('SIGKILL'); });
  let stdout = '';
  let stderr = '';
  process.stdout.on('data', value => { stdout += value; });
  process.stderr.on('data', value => { stderr += value; });
  const exited = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('exit', (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`child exited ${code ?? signal}\n${stderr}\n${stdout}`));
    });
  });
  // Attach a rejection handler before awaiting the startup barrier.
  exited.catch(() => {});
  const message = new Promise((resolve, reject) => {
    process.once('message', resolve);
    exited.then(() => reject(new Error('child exited before startup barrier')), reject);
  });
  return { process, exited, message };
}

function fileSizeLimitedChild(t, maxBytes, code) {
  const python = 'import os,resource,signal,sys; signal.signal(signal.SIGXFSZ,signal.SIG_IGN); n=int(sys.argv[1]); resource.setrlimit(resource.RLIMIT_FSIZE,(n,n)); os.execv(sys.argv[2],sys.argv[2:])';
  const limited = child(t, 'python3', ['-c', python, String(maxBytes), process.execPath, '--input-type=module', '--eval', code]);
  limited.message.catch(() => {});
  return limited.exited;
}

test('reservations are durable, detached, idempotent, and count against the default two-worker capacity', async t => {
  const path = await directory(t);
  const admission = new Admission({ directory: path });
  assert.deepEqual(await admission.list(ownerScope), []);
  assert.equal(await admission.get('missing', ownerScope), undefined);
  const first = await admission.reserve(request());
  assert.deepEqual(first, { ...request(), state: 'reserved', resources: {
    location: { state: 'absent', evidence: null, attempt: null },
    worktree: { state: 'absent', evidence: null, attempt: null }, session: { state: 'absent', evidence: null, attempt: null },
  } });
  first.intentions.session = 'mutated-by-caller';
  first.spec.model = 'mutated-by-caller';
  const reloaded = new Admission({ directory: path });
  assert.deepEqual(await reloaded.reserve(request()), await admission.get('worker-a', ownerScope));
  assert.equal((await reloaded.get('worker-a', ownerScope)).intentions.session, 'ses_workera');
  assert.deepEqual((await reloaded.get('worker-a', ownerScope)).spec, executionSpec);
  await reloaded.reserve(request('worker-b', { owner: 'owner-b', project: '/projects/b' }));
  await assert.rejects(admission.reserve(request('worker-c')), errorCode('CAPACITY'));
  assert.deepEqual((await admission.list(ownerScope)).map(r => r.id), ['worker-a']);
  assert.equal(await admission.get('missing', ownerScope), undefined);
});

test('settled but uncertain location creation remains charged until location execution is terminal', async t => {
  const path = await directory(t);
  const admission = new Admission({ directory: path, limits: { activeWorkers: 1 } });
  await admission.reserve(request());
  const { record: acquiring, changed, completionToken } = await admission.update('worker-a', ownerScope, { type: 'acquire', resource: 'location' });
  assert.equal(changed, true);
  assert.equal(acquiring.state, 'acquiring');
  assert.equal(acquiring.resources.location.state, 'possible');
  assert.deepEqual(await admission.update('worker-a', ownerScope, { type: 'acquire', resource: 'location' }), { record: acquiring, changed: false, completionToken: null });
  await admission.update('worker-a', ownerScope, { type: 'complete', resource: 'location', completionToken, outcome: 'unknown' });
  const reloaded = new Admission({ directory: path, limits: { activeWorkers: 1 } });
  assert.equal((await reloaded.get('worker-a', ownerScope)).state, 'uncertain');
  assert.equal((await reloaded.reserve(request())).resources.location.state, 'possible');
  await assert.rejects(reloaded.reserve(request('worker-b')), errorCode('CAPACITY'));
  await assert.rejects(reloaded.update('worker-a', ownerScope, { type: 'acquire', resource: 'location' }), errorCode('INVALID_TRANSITION'));
  await assert.rejects(reloaded.release('worker-a', ownerScope), errorCode('INVALID_TRANSITION'));
  await reloaded.update('worker-a', ownerScope, { type: 'stop' });
  await assert.rejects(reloaded.release('worker-a', ownerScope), errorCode('INVALID_TRANSITION'));
  await reloaded.update('worker-a', ownerScope, { type: 'verify', resource: 'worktree', state: 'absent', evidence: 'Checkout creation was not attempted' });
  await assert.rejects(reloaded.release('worker-a', ownerScope), errorCode('INVALID_TRANSITION'));
  await reloaded.update('worker-a', ownerScope, { type: 'verify', resource: 'session', state: 'absent', evidence: 'Session creation was not attempted' });
  await assert.rejects(reloaded.release('worker-a', ownerScope), errorCode('INVALID_TRANSITION'));
  await reloaded.update('worker-a', ownerScope, { type: 'verify', resource: 'location', state: 'retained', evidence: 'Location executor and all its work are quiescent; control files retained' });
  const stopped = await reloaded.release('worker-a', ownerScope);
  assert.equal(stopped.state, 'stopped');
  assert.deepEqual(await reloaded.release('worker-a', ownerScope), stopped);
  assert.equal((await reloaded.reserve(request())).state, 'stopped');
  assert.equal((await reloaded.reserve(request('worker-b'))).state, 'reserved');
  assert.equal((await reloaded.list(ownerScope)).length, 2);
});

test('stop cannot verify absence or release while an authorized delayed creator may resume', { timeout: 10000 }, async t => {
  const path = await directory(t);
  const artifacts = await directory(t);
  const input = request('worker-a', { intentions: { ...request().intentions, worktree: join(artifacts, 'checkout') } });
  const admission = new Admission({ directory: path, limits: { activeWorkers: 1 } });
  await admission.reserve(input);
  const acquired = await admission.update(input.id, ownerScope, { type: 'acquire', resource: 'worktree' });
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const creator = (async () => {
    await gate;
    await mkdir(input.intentions.worktree);
    await writeFile(join(input.intentions.worktree, 'keep'), 'late artifact');
    return admission.update(input.id, ownerScope, { type: 'complete', resource: 'worktree', completionToken: acquired.completionToken, outcome: 'present' });
  })();
  const reloaded = new Admission({ directory: path, limits: { activeWorkers: 1 } });
  let completed;
  try {
    await reloaded.update(input.id, ownerScope, { type: 'stop' });
    for (const resource of ['location', 'worktree', 'session']) {
      await assert.rejects(reloaded.update(input.id, ownerScope, { type: 'verify', resource, state: 'absent', evidence: 'Absent right now' }), errorCode('CREATOR_OUTSTANDING'));
    }
    await assert.rejects(reloaded.release(input.id, ownerScope), errorCode('INVALID_TRANSITION'));
    await assert.rejects(reloaded.reserve(request('worker-b')), errorCode('CAPACITY'));
  } finally {
    resume();
    completed = await creator;
  }
  assert.equal(completed.record.state, 'stopping');
  assert.equal(completed.record.resources.worktree.state, 'present');
  await assert.rejects(reloaded.release(input.id, ownerScope), errorCode('INVALID_TRANSITION'));
  await assert.rejects(reloaded.update(input.id, ownerScope, { type: 'complete', resource: 'worktree', completionToken: acquired.completionToken, outcome: 'present' }), errorCode('INVALID_COMPLETION'));
  for (const resource of ['location', 'session']) {
    await reloaded.update(input.id, ownerScope, { type: 'verify', resource, state: 'absent', evidence: 'Creation never attempted and creator settled' });
  }
  await reloaded.update(input.id, ownerScope, { type: 'verify', resource: 'worktree', state: 'retained', evidence: 'Creator settled; no executor can use checkout; files retained' });
  assert.equal((await reloaded.release(input.id, ownerScope)).state, 'stopped');
  assert.equal(await readFile(join(input.intentions.worktree, 'keep'), 'utf8'), 'late artifact');
  assert.equal((await reloaded.reserve(request('worker-b'))).state, 'reserved');
});

test('creator exit and restart keep an outstanding session charged until explicit quiescence recovery', { timeout: 10000 }, async t => {
  const path = await directory(t);
  const input = request();
  const code = `
    import { Admission } from ${JSON.stringify(moduleURL)};
    const admission = new Admission({directory:${JSON.stringify(path)},limits:{activeWorkers:1}});
    await admission.reserve(${JSON.stringify(input)});
    const result = await admission.update('worker-a',${JSON.stringify(ownerScope)},{type:'acquire',resource:'session'});
    console.log(JSON.stringify({completionToken:result.completionToken}));
    process.disconnect();
  `;
  const creator = child(t, process.execPath, ['--input-type=module', '--eval', code]);
  creator.message.catch(() => {});
  const { completionToken } = JSON.parse((await creator.exited).stdout);
  const reloaded = new Admission({ directory: path, limits: { activeWorkers: 1 } });
  const record = await reloaded.get(input.id, ownerScope);
  assert.equal(record.intentions.session, 'ses_workera');
  assert.equal(record.resources.session.state, 'possible');
  assert.equal(record.resources.session.attempt.state, 'outstanding');
  assert.equal(JSON.stringify(record).includes(completionToken), false);
  await assert.rejects(reloaded.reserve(request('worker-b')), errorCode('CAPACITY'));
  await reloaded.update(input.id, ownerScope, { type: 'stop' });
  await assert.rejects(reloaded.update(input.id, ownerScope, { type: 'verify', resource: 'session', state: 'absent', evidence: 'Session not found' }), errorCode('CREATOR_OUTSTANDING'));
  const evidence = 'Creator child exited before dispatching any external operation; no creator or remote request can resume';
  const recovered = await reloaded.update(input.id, ownerScope, { type: 'recover-quiescent', resource: 'session', evidence });
  assert.deepEqual(recovered.record.resources.session.attempt, { state: 'recovered', evidence });
  assert.equal(recovered.record.resources.session.state, 'possible');
  assert.equal((await reloaded.update(input.id, ownerScope, { type: 'recover-quiescent', resource: 'session', evidence })).changed, false);
  await assert.rejects(reloaded.release(input.id, ownerScope), errorCode('INVALID_TRANSITION'));
  await assert.rejects(reloaded.update(input.id, ownerScope, { type: 'complete', resource: 'session', completionToken, outcome: 'present' }), errorCode('INVALID_COMPLETION'));
  assert.equal((await stopUnused(reloaded)).state, 'stopped');
  assert.equal((await reloaded.reserve(request('worker-b'))).state, 'reserved');
});

test('an ambiguous settled create preserves the exact planned session ID for cleanup after restart', async t => {
  const path = await directory(t);
  const admission = new Admission({ directory: path, limits: { activeWorkers: 1 } });
  await admission.reserve(request('worker-a', { intentions: { ...request().intentions, session: 'ses_ExactPlanned123' } }));
  const acquired = await admission.update('worker-a', ownerScope, { type: 'acquire', resource: 'session' });
  const sessions = new Set();
  const createSession = async id => {
    sessions.add(id);
    throw new Error('Creation settled but response was lost');
  };
  await assert.rejects(createSession(acquired.record.intentions.session));
  await admission.update('worker-a', ownerScope, { type: 'complete', resource: 'session', completionToken: acquired.completionToken, outcome: 'unknown' });
  const reloaded = new Admission({ directory: path, limits: { activeWorkers: 1 } });
  const record = await reloaded.get('worker-a', ownerScope);
  assert.equal(record.intentions.session, 'ses_ExactPlanned123');
  assert.equal(sessions.has(record.intentions.session), true);
  assert.equal(record.resources.session.state, 'possible');
  await assert.rejects(reloaded.reserve(request('worker-b')), errorCode('CAPACITY'));
  await reloaded.update('worker-a', ownerScope, { type: 'stop' });
  assert.equal(sessions.delete(record.intentions.session), true);
  await reloaded.update('worker-a', ownerScope, { type: 'verify', resource: 'session', state: 'released', evidence: 'Exact planned session was found and stopped; no queued work remains' });
  for (const resource of ['location', 'worktree']) {
    await reloaded.update('worker-a', ownerScope, { type: 'verify', resource, state: 'absent', evidence: 'Creation was not attempted' });
  }
  await reloaded.release('worker-a', ownerScope);
  assert.equal((await reloaded.reserve(request('worker-b'))).state, 'reserved');
});

test('container lifecycle requires every intended resource and preserves actual resource files', async t => {
  const path = await directory(t);
  const artifacts = await directory(t);
  const worktree = join(artifacts, 'checkout');
  const location = join(artifacts, 'control');
  await mkdir(worktree);
  await mkdir(location);
  await writeFile(join(worktree, 'keep'), 'retained resource');
  await writeFile(join(location, 'keep'), 'retained control');
  const admission = new Admission({ directory: path });
  const input = request('container-worker', { backend: 'container', intentions: {
    location, worktree, session: 'ses_ActualHostSession', container: 'intended-container-name',
  } });
  await admission.reserve(input);
  for (const resource of ['location', 'worktree', 'session', 'container']) {
    await assert.rejects(admission.update(input.id, ownerScope, { type: 'activate' }), errorCode('INVALID_TRANSITION'));
    await createResource(admission, input.id, resource);
  }
  const { record: active } = await admission.update(input.id, ownerScope, { type: 'activate' });
  assert.equal(active.state, 'active');
  assert.deepEqual(await admission.update(input.id, ownerScope, { type: 'activate' }), { record: active, changed: false, completionToken: null });
  await admission.update(input.id, ownerScope, { type: 'stop' });
  await assert.rejects(admission.update(input.id, ownerScope, { type: 'activate' }), errorCode('INVALID_TRANSITION'));
  for (const resource of ['location', 'worktree', 'session', 'container']) {
    await assert.rejects(admission.update(input.id, ownerScope, { type: 'verify', resource, state: 'absent', evidence: 'incorrect state' }), errorCode('INVALID_TRANSITION'));
    const artifact = ['location', 'worktree'].includes(resource);
    await assert.rejects(admission.update(input.id, ownerScope, { type: 'verify', resource, state: artifact ? 'released' : 'retained', evidence: 'Wrong terminal meaning' }), errorCode('INVALID_TRANSITION'));
    await admission.update(input.id, ownerScope, { type: 'verify', resource, state: artifact ? 'retained' : 'released', evidence: 'Caller verified execution terminal; artifact files kept' });
  }
  await admission.release(input.id, ownerScope);
  assert.equal(await readFile(join(worktree, 'keep'), 'utf8'), 'retained resource');
  assert.equal(await readFile(join(location, 'keep'), 'utf8'), 'retained control');
  const stopped = await admission.get(input.id, ownerScope);
  assert.equal(stopped.resources.worktree.state, 'retained');
  assert.equal(stopped.resources.location.state, 'retained');
  await assert.rejects(admission.update(input.id, ownerScope, { type: 'uncertain' }), errorCode('INVALID_TRANSITION'));
});

test('stopped records remain retained and saturation refuses new records rather than deleting history', async t => {
  const path = await directory(t);
  const admission = new Admission({ directory: path, limits: { retainedRecords: 1 } });
  await admission.reserve(request());
  await stopUnused(admission);
  const before = await admission.list(ownerScope);
  await assert.rejects(admission.reserve(request('worker-b')), errorCode('RETENTION'));
  assert.deepEqual(await admission.list(ownerScope), before);
  assert.equal((await admission.reserve(request())).state, 'stopped');
});

test('persisted capacity policy cannot be bypassed by a second handle with different limits', async t => {
  const path = await directory(t);
  await new Admission({ directory: path, limits: { activeWorkers: 1 } }).reserve(request());
  const other = new Admission({ directory: path, limits: { activeWorkers: 2 } });
  await assert.rejects(other.reserve(request('worker-b')), errorCode('LIMIT_MISMATCH'));
  await assert.rejects(other.list(ownerScope), errorCode('LIMIT_MISMATCH'));
});

test('owner, project, and immutable identity checks apply before any lifecycle change', async t => {
  const admission = new Admission({ directory: await directory(t) });
  const before = await admission.reserve(request());
  for (const wrong of [{ ...ownerScope, owner: 'other-owner' }, { ...ownerScope, project: '/projects/other' }]) {
    await assert.rejects(admission.get('worker-a', wrong), errorCode('SCOPE_MISMATCH'));
    await assert.rejects(admission.update('worker-a', wrong, { type: 'stop' }), errorCode('SCOPE_MISMATCH'));
    await assert.rejects(admission.release('worker-a', wrong), errorCode('SCOPE_MISMATCH'));
    await assert.rejects(admission.reserve(request('worker-a', wrong)), errorCode('SCOPE_MISMATCH'));
    assert.deepEqual(await admission.list(wrong), []);
  }
  for (const field of ['location', 'worktree', 'session']) {
    const changed = { ...request().intentions, [field]: field === 'session' ? 'ses_Different' : '/different' };
    await assert.rejects(admission.reserve(request('worker-a', { intentions: changed })), errorCode('IDENTITY_MISMATCH'));
  }
  await assert.rejects(admission.reserve(request('worker-a', { backend: 'container', intentions: { ...request().intentions, container: 'c' } })), errorCode('IDENTITY_MISMATCH'));
  await assert.rejects(admission.update('missing', ownerScope, { type: 'stop' }), errorCode('NOT_FOUND'));
  assert.deepEqual(await admission.get('worker-a', ownerScope), before);
});

test('reserve replay binds the full canonical execution spec and rejects each changed execution choice', async t => {
  const path = await directory(t);
  const admission = new Admission({ directory: path });
  const original = await admission.reserve(request());
  const reordered = { promptID: 'prompt-a', ref: 'a'.repeat(40), model: 'provider/model#variant', task: 'implementation', role: 'poteto-agent' };
  assert.deepEqual(await admission.reserve(request('worker-a', { spec: reordered })), original);
  for (const [key, value] of Object.entries({ role: 'poteto-reviewer', task: 'review', model: 'other/model', ref: 'b'.repeat(40), promptID: 'prompt-b' })) {
    await assert.rejects(admission.reserve(request('worker-a', { spec: { ...executionSpec, [key]: value } })), errorCode('IDENTITY_MISMATCH'));
  }
  assert.deepEqual((await new Admission({ directory: path }).get('worker-a', ownerScope)).spec, executionSpec);
});

test('external input rejects malformed identities, arbitrary mutation, and evidence-free verification', async t => {
  const path = await directory(t);
  for (const options of [{}, { directory: 'relative' }, { directory: `${path}/../other` },
    { directory: `${path}/` }, { directory: path, limits: { activeWorkers: 0 } },
    { directory: path, limits: { retainedRecords: 10001 } }, { directory: path, extra: true }]) {
    assert.throws(() => new Admission(options), errorCode('INVALID_INPUT'));
  }
  const admission = new Admission({ directory: path });
  for (const input of [request('../bad'), request('a', { owner: '' }), request('a', { project: 'relative' }),
    request('a', { backend: 'remote' }), request('a', { intentions: { worktree: '/w' } }),
    request('a', { intentions: { worktree: '/w', session: 's', container: 'unexpected' } }),
    request('a', { intentions: { ...request().intentions, location: 'relative' } }),
    request('a', { backend: 'container', intentions: { ...request().intentions, location: request().intentions.worktree, container: 'pstack-a' } }),
    ...['requested-title', 'ses_', 'ses_bad-id', 'ses_bad_id', 'ses_abc\n'].map(session => request('a', { intentions: { ...request().intentions, session } })),
    ...[null, {}, { ...executionSpec, role: 'admin' }, { ...executionSpec, task: 'unbounded' },
      { ...executionSpec, model: '' }, { ...executionSpec, model: 'm'.repeat(257) },
      { ...executionSpec, ref: '' }, { ...executionSpec, ref: 'r'.repeat(257) },
      { ...executionSpec, promptID: '../prompt' }, { ...executionSpec, extra: true }].map(spec => request('a', { spec })),
    { ...request(), state: 'active' }]) {
    await assert.rejects(admission.reserve(input), errorCode('INVALID_INPUT'));
  }
  await admission.reserve(request());
  for (const command of [{ type: 'stop', owner: 'other' }, { type: 'verify', resource: 'worktree', state: 'absent', evidence: '' },
    { type: 'acquire', resource: 'unknown' }, { type: 'present', resource: 'session' },
    { type: 'complete', resource: 'session', completionToken: '', outcome: 'present' },
    { type: 'complete', resource: 'session', completionToken: 'x', outcome: 'absent' },
    { type: 'recover-quiescent', resource: 'session', evidence: '' },
    { type: 'patch', state: 'stopped' }]) {
    await assert.rejects(admission.update('worker-a', ownerScope, command), errorCode('INVALID_INPUT'));
  }
  await assert.rejects(admission.update('worker-a', ownerScope, { type: 'acquire', resource: 'container' }), errorCode('INVALID_TRANSITION'));
  assert.equal((await admission.get('worker-a', ownerScope)).state, 'reserved');
});

test('completion tokens are bound to one resource attempt and cannot acknowledge another creator', async t => {
  const admission = new Admission({ directory: await directory(t) });
  await admission.reserve(request());
  await admission.reserve(request('worker-b'));
  const first = await admission.update('worker-a', ownerScope, { type: 'acquire', resource: 'worktree' });
  const second = await admission.update('worker-a', ownerScope, { type: 'acquire', resource: 'session' });
  const other = await admission.update('worker-b', ownerScope, { type: 'acquire', resource: 'worktree' });
  for (const completionToken of [second.completionToken, other.completionToken, 'forged']) {
    await assert.rejects(admission.update('worker-a', ownerScope, { type: 'complete', resource: 'worktree', completionToken, outcome: 'present' }), errorCode('INVALID_COMPLETION'));
  }
  const completed = await admission.update('worker-a', ownerScope, { type: 'complete', resource: 'worktree', completionToken: first.completionToken, outcome: 'present' });
  assert.equal(completed.record.resources.worktree.state, 'present');
  assert.equal(completed.record.resources.session.attempt.state, 'outstanding');
  assert.equal((await admission.update('worker-a', ownerScope, { type: 'acquire', resource: 'worktree' })).completionToken, null);
  await admission.update('worker-a', ownerScope, { type: 'stop' });
  await assert.rejects(admission.update('worker-a', ownerScope, { type: 'verify', resource: 'worktree', state: 'retained', evidence: 'Session creator still outstanding' }), errorCode('CREATOR_OUTSTANDING'));
  const late = await admission.update('worker-a', ownerScope, { type: 'complete', resource: 'session', completionToken: second.completionToken, outcome: 'unknown' });
  assert.equal(late.record.state, 'stopping');
  assert.equal(late.record.resources.session.state, 'possible');
});

test('two independent handles cannot over-admit concurrent reservations', async t => {
  const path = await directory(t);
  const handles = [new Admission({ directory: path }), new Admission({ directory: path })];
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
    retryLocked(() => handles[i % 2].reserve(request(`worker-${i}`)))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'CAPACITY').length, 6);
  assert.equal((await new Admission({ directory: path }).list(ownerScope)).length, 2);
});

test('concurrent replays grant only one initial acquisition attempt for the same identity', async t => {
  const path = await directory(t);
  const handles = [new Admission({ directory: path }), new Admission({ directory: path })];
  const reservations = await Promise.all(handles.map(handle => retryLocked(() => handle.reserve(request()))));
  assert.deepEqual(reservations[0], reservations[1]);
  const attempts = await Promise.all(handles.map(handle => retryLocked(() =>
    handle.update('worker-a', ownerScope, { type: 'acquire', resource: 'worktree' }))));
  assert.equal(attempts.filter(result => result.changed).length, 1);
  assert.equal(attempts.filter(result => !result.changed).length, 1);
  assert.equal(attempts.filter(result => typeof result.completionToken === 'string').length, 1);
  const reloaded = new Admission({ directory: path });
  const replay = await reloaded.update('worker-a', ownerScope, { type: 'acquire', resource: 'worktree' });
  assert.equal(replay.changed, false);
  assert.equal(replay.completionToken, null);
  assert.equal(replay.record.resources.worktree.state, 'possible');
  assert.equal((await reloaded.list(ownerScope)).length, 1);
});

test('separate processes coordinate capacity across owners and project locations', { timeout: 10000 }, async t => {
  const path = await directory(t);
  const children = [0, 1].map(index => child(t, process.execPath, ['--input-type=module', '--eval', `
    import { Admission } from ${JSON.stringify(moduleURL)};
    import { setTimeout as delay } from 'node:timers/promises';
    const handles = [new Admission({directory:${JSON.stringify(path)}}), new Admission({directory:${JSON.stringify(path)}})];
    process.once('message', async () => {
      const results = await Promise.all(handles.map(async (handle, i) => {
        const id = 'process-${index}-' + i;
        const request = {id,owner:'owner-${index}',project:'/projects/${index}',backend:'local',spec:${JSON.stringify(executionSpec)},intentions:{location:'/locations/'+id,worktree:'/worktrees/'+id,session:'ses_'+id.replace(/[^a-zA-Z0-9]/g,'')}};
        for (let attempt = 0; attempt < 500; attempt++) {
          try { return {id,state:(await handle.reserve(request)).state}; }
          catch (error) {
            if (error.code !== 'LOCKED') return {id,error:error.code};
            await delay(2);
          }
        }
        throw new Error('bounded lock retries exhausted');
      }));
      console.log(JSON.stringify(results));
      process.disconnect();
    });
    process.send('ready');
  `]));
  assert.deepEqual(await Promise.all(children.map(c => c.message)), ['ready', 'ready']);
  for (const c of children) c.process.send('go');
  const results = (await Promise.all(children.map(c => c.exited))).flatMap(r => JSON.parse(r.stdout));
  assert.equal(results.filter(r => r.state === 'reserved').length, 2);
  assert.equal(results.filter(r => r.error === 'CAPACITY').length, 2);
  const reloaded = new Admission({ directory: path });
  const records = (await Promise.all([0, 1].map(index => retryLocked(() => reloaded.list({ owner: `owner-${index}`, project: `/projects/${index}` }))))).flat();
  assert.deepEqual(records.map(r => r.id).sort(), results.filter(r => r.state === 'reserved').map(r => r.id).sort());
});

test('old, malformed, and symlink locks never authorize automatic stale reclamation', async t => {
  for (const kind of ['old', 'directory', 'symlink', 'hardlink']) {
    await t.test(kind, async t => {
      const path = await directory(t);
      const lock = join(path, 'lock');
      if (kind === 'directory') await mkdir(lock);
      else if (kind === 'symlink') await symlink('/does/not/exist', lock);
      else {
        await writeFile(lock, 'ambiguous lock');
        if (kind === 'old') await utimes(lock, new Date(0), new Date(0));
        else await link(lock, join(path, 'other-link'));
      }
      const before = await lstat(lock);
      const admission = new Admission({ directory: path });
      await assert.rejects(admission.reserve(request()), errorCode('LOCKED'));
      await assert.rejects(admission.list(ownerScope), errorCode('LOCKED'));
      assert.equal((await lstat(lock)).ino, before.ino);
    });
  }
});

test('corrupt, incomplete, and ambiguous ledgers fail closed on reload', async t => {
  const mutations = {
    truncated: async path => writeFile(join(path, 'ledger.json'), '{'),
    'invalid UTF-8': async path => {
      const data = await readFile(join(path, 'ledger.json'));
      data[data.indexOf('worker-a')] = 0xff;
      await writeFile(join(path, 'ledger.json'), data);
    },
    'invalid terminal state': async path => {
      const data = JSON.parse(await readFile(join(path, 'ledger.json'), 'utf8'));
      data.records[0].state = 'stopped';
      await writeFile(join(path, 'ledger.json'), JSON.stringify(data, null, 2) + '\n');
    },
    'duplicate identity': async path => {
      const data = JSON.parse(await readFile(join(path, 'ledger.json'), 'utf8'));
      data.records.push(data.records[0]);
      await writeFile(join(path, 'ledger.json'), JSON.stringify(data, null, 2) + '\n');
    },
    'missing ledger': async path => unlink(join(path, 'ledger.json')),
    'missing marker': async path => unlink(join(path, 'initialized')),
    'invalid marker': async path => writeFile(join(path, 'initialized'), 'invalid'),
    'unfinished write': async path => writeFile(join(path, 'ledger.next'), '{}'),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async t => {
      const path = await directory(t);
      await new Admission({ directory: path }).reserve(request());
      await mutate(path);
      const reloaded = new Admission({ directory: path });
      const failsClosed = error => error instanceof AdmissionError && ['CORRUPT_LEDGER', 'UNSAFE_FILESYSTEM'].includes(error.code);
      await assert.rejects(reloaded.reserve(request('worker-b')), failsClosed);
      await assert.rejects(reloaded.list(ownerScope), failsClosed);
    });
  }
});

test('symlink and hardlink data boundaries are rejected without altering their targets', async t => {
  for (const name of ['ledger.json', 'initialized']) {
    for (const kind of ['symlink', 'hardlink']) {
      await t.test(`${name} ${kind}`, async t => {
        const path = await directory(t);
        const elsewhere = await directory(t);
        await new Admission({ directory: path }).reserve(request());
        const target = join(elsewhere, name);
        const bytes = await readFile(join(path, name));
        await writeFile(target, bytes);
        await unlink(join(path, name));
        if (kind === 'symlink') await symlink(target, join(path, name));
        else await link(target, join(path, name));
        await assert.rejects(new Admission({ directory: path }).reserve(request('worker-b')), errorCode('UNSAFE_FILESYSTEM'));
        assert.deepEqual(await readFile(target), bytes);
      });
    }
  }
});

test('a canonical ledger directory and its ancestors cannot be symlink aliases', async t => {
  const root = await directory(t);
  const actual = join(root, 'actual');
  await mkdir(actual);
  await mkdir(join(actual, 'nested'));
  const alias = join(root, 'alias');
  await symlink(actual, alias);
  await assert.rejects(new Admission({ directory: alias }).reserve(request()));
  await assert.rejects(new Admission({ directory: join(alias, 'nested') }).reserve(request()), errorCode('UNSAFE_FILESYSTEM'));
  assert.equal((await new Admission({ directory: join(actual, 'nested') }).reserve(request())).state, 'reserved');
});

test('a real filesystem write failure returns no reservation and retains a recovery barrier', { timeout: 10000 }, async t => {
  const path = await directory(t);
  const admission = new Admission({ directory: path });
  await admission.reserve(request());
  const before = await readFile(join(path, 'ledger.json'));
  const code = `
    import { Admission } from ${JSON.stringify(moduleURL)};
    const admission = new Admission({directory:${JSON.stringify(path)}});
    try {
      await admission.reserve(${JSON.stringify(request('failed-worker'))});
      throw new Error('failed persistence must never return a reservation');
    } catch (error) {
      if (error.code !== 'PERSISTENCE') throw error;
      console.log(JSON.stringify({error:error.code}));
    }
    process.disconnect();
  `;
  assert.deepEqual(JSON.parse((await fileSizeLimitedChild(t, 1024, code)).stdout), { error: 'PERSISTENCE' });
  assert.deepEqual(await readFile(join(path, 'ledger.json')), before);
  await assert.rejects(new Admission({ directory: path }).reserve(request('later-worker')), errorCode('LOCKED'));
  assert.ok((await lstat(join(path, 'lock'))).isFile());
});

test('a failed durable acquisition returns no creation authorization', { timeout: 10000 }, async t => {
  const path = await directory(t);
  await new Admission({ directory: path }).reserve(request());
  const before = await readFile(join(path, 'ledger.json'));
  const code = `
    import { Admission } from ${JSON.stringify(moduleURL)};
    try {
      await new Admission({directory:${JSON.stringify(path)}}).update('worker-a', ${JSON.stringify(ownerScope)}, {type:'acquire',resource:'worktree'});
      throw new Error('failed persistence must never authorize creation');
    } catch (error) {
      if (error.code !== 'PERSISTENCE') throw error;
      console.log(JSON.stringify({error:error.code}));
    }
    process.disconnect();
  `;
  assert.deepEqual(JSON.parse((await fileSizeLimitedChild(t, 128, code)).stdout), { error: 'PERSISTENCE' });
  assert.deepEqual(await readFile(join(path, 'ledger.json')), before);
  await assert.rejects(new Admission({ directory: path }).update('worker-a', ownerScope, { type: 'acquire', resource: 'worktree' }), errorCode('LOCKED'));
});

test('failed durable cleanup acquisition returns no external cleanup authorization', {timeout:10000}, async t => {
  const path = await directory(t);
  await new Admission({directory:path}).reserve(request());
  const before = await readFile(join(path,'ledger.json'));
  const code = `
    import {Admission} from ${JSON.stringify(moduleURL)};
    try {
      await new Admission({directory:${JSON.stringify(path)}}).update('worker-a',${JSON.stringify(ownerScope)},{type:'access',kind:'stop'});
      throw new Error('Failed cleanup persistence must not return authorization');
    } catch(error) { if(error.code !== 'PERSISTENCE') throw error; console.log(JSON.stringify({code:error.code})); }
    process.disconnect();
  `;
  assert.deepEqual(JSON.parse((await fileSizeLimitedChild(t,128,code)).stdout),{code:'PERSISTENCE'});
  assert.deepEqual(await readFile(join(path,'ledger.json')),before);
  await assert.rejects(new Admission({directory:path}).update('worker-a',ownerScope,{type:'access',kind:'stop'}),errorCode('LOCKED'));
});
