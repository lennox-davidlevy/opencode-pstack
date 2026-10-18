import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionID } from '@opencode/schema/session-id';
import { SessionMessage } from '@opencode/schema/session-message';
import { Admission } from '../plugins/pstack/admission.js';
import { localServerIdentity, WorkerLifecycle } from '../plugins/pstack/worker-lifecycle.js';
import { isolatedOpenCode } from './helpers/isolated-opencode.js';
import { makeTempDir } from './helpers/temp.js';

test('production stop drains a real queued input and evicts only its owned location',
  { skip: process.env.PSTACK_PORTABILITY_TEST !== '1', timeout: 60000 }, async t => {
    const root = await makeTempDir('pstack-lifecycle-native-');
    let server;
    t.after(async () => {
      if (server) { await server.stop(); await rm(root, { recursive: true, force: true }); }
    });
    const project = join(root, 'project');
    const checkout = join(root, 'checkout');
    const ledger = join(root, 'ledger');
    for (const path of [project, checkout, ledger]) await mkdir(path);
    for (const path of [project, checkout]) await writeFile(join(path, 'opencode.json'), JSON.stringify({
      agents: { poteto: { mode: 'primary' }, 'poteto-agent': { mode: 'subagent' } },
      snapshots: false, lsp: false, formatter: false,
    }));
    await writeFile(join(checkout, 'retained.txt'), 'worker output stays here');
    server = await isolatedOpenCode(root, { signal: t.signal }, { registerService: true });
    const identity = await localServerIdentity(await server.api('GET', '/api/info'), server.endpoint);
    const parent = (await server.api('POST', '/api/session', { agent: 'poteto', location: { directory: project } })).data;
    const owner = parent.id;
    const id = randomUUID();
    const sessionID = SessionID.create();
    const promptID = SessionMessage.ID.create();
    const ref = 'a'.repeat(40);
    const scope = { owner, project };
    const admission = new Admission({ directory: ledger, limits: { activeWorkers: 1, retainedRecords: 10 } });
    await admission.reserve({ id, ...scope, backend: 'local',
      intentions: { location: checkout, worktree: checkout, session: sessionID },
      spec: { role: 'poteto-agent', task: 'implementation', model: 'openai/gpt-6.1-sol#high', ref, promptID },
      plan: { prompt: 'Retain this queued input without running a model', permissions: [], server: identity },
    });
    for (const resource of ['worktree', 'location']) {
      const { completionToken } = await admission.update(id, scope, { type: 'acquire', resource });
      await admission.update(id, scope, { type: 'complete', resource, completionToken, outcome: 'present' });
    }
    const { completionToken } = await admission.update(id, scope, { type: 'acquire', resource: 'session' });
    await server.api('POST', '/api/session', { id: sessionID, agent: 'poteto-agent', location: { directory: checkout },
      metadata: { pstackWorker: id, pstackOwner: owner, pstackSource: project, pstackRef: ref, pstackServer: identity } });
    await server.api('POST', `/api/session/${sessionID}/shell`, { command: "printf 'pstack-owned-history-fixture\\n'" });
    let history;
    for (let attempt = 0; attempt < 100; attempt++) {
      history = (await server.api('GET', `/api/session/${sessionID}/message`)).data;
      if (history.some(message => message.type === 'shell' && message.status === 'exited')) break;
      await delay(50, undefined, { signal: t.signal });
    }
    assert.ok(history.some(message => message.type === 'shell' && message.exit === 0
      && message.output?.output === 'pstack-owned-history-fixture\n'));
    for (const item of (await server.api('GET', `/api/session/${sessionID}/inbox`)).data) {
      await server.api('DELETE', `/api/session/${sessionID}/inbox/${item.id}`);
    }
    await server.api('POST', `/api/session/${sessionID}/prompt`, { id: promptID, text: 'Fixture input', resume: false });
    assert.equal((await server.api('GET', `/api/session/${sessionID}/inbox`)).data.length, 1);
    await admission.update(id, scope, { type: 'complete', resource: 'session', completionToken, outcome: 'present' });
    await admission.update(id, scope, { type: 'activate' });
    await server.verifyLocation(project);
    await server.verifyLocation(checkout);

    const projections = new Map();
    const lifecycle = new WorkerLifecycle({ options: { server: { registrationFile: server.registrationFile }, admission: { directory: ledger, limits: { activeWorkers: 1, retainedRecords: 10 } } },
      storage: { async get(key) { return projections.get(key); }, async set(key, value) { projections.set(key, value); } },
    }, root, project, 'fixture/worker/', async () => {});
    t.after(() => lifecycle.close());
    const result = await lifecycle.stop(owner, id);
    assert.equal(result.state, 'stopped', JSON.stringify(result.cleanupErrors));
    assert.equal((await admission.get(id, scope)).state, 'stopped');
    assert.equal(await readFile(join(checkout, 'retained.txt'), 'utf8'), 'worker output stays here');
    const loaded = (await server.api('GET', '/api/debug/location')).map(location => location.directory);
    assert.ok(loaded.includes(project));
    assert.ok(!loaded.includes(checkout));
    assert.deepEqual((await server.api('GET', `/api/session/${sessionID}/message`)).data, history);
    assert.deepEqual((await lifecycle.messages(owner, id, 100, undefined, t.signal)).data, history);
    assert.equal((await lifecycle.stop(owner, id)).state, 'stopped');
    assert.ok(!(await server.api('GET', '/api/debug/location')).some(location => location.directory === checkout), 'A stopped worker must not reload its services');
    assert.deepEqual((await server.api('GET', '/api/credential')).data, []);
    t.diagnostic('Real queued input and targeted cleanup APIs; no model generation, Docker, or shared-server access');
  });
