import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { makeTempDir } from './helpers/temp.js';
import { isolatedOpenCode } from './helpers/isolated-opencode.js';

const reviewAction = 'pstack_worker_review';
const historyTool = 'tools.pstack.history_read';

// This is a no-data prerequisite prototype, not the production worker review route.
function fixturePlugin(nonce) {
  return `export default {
    id: 'pstack.review-permission-fixture',
    async setup(ctx) {
      const resource = ctx.location.directory + '/synthetic-no-data';
      const evaluations = new Map();
      await ctx.permission.hook('evaluate', event => {
        if (event.metadata?.fault === 'system-error') throw new Error('Synthetic permission evaluator failure');
        if (event.action === 'pstack_worker_review' && event.effect !== 'deny') {
          event.effect = 'ask';
          event.message = 'Synthetic no-data review permission fixture';
        }
        if (evaluations.has(event.source?.id)) {
          evaluations.set(event.source.id, { action: event.action, effect: event.effect });
        }
      });
      await ctx.rpc.register({
        id: 'pstack-review-permission-fixture', events: {},
        methods: { read: {
          input: { type: 'object', properties: {
            sessionID: { type: 'string' }, seed: { type: 'boolean' },
            agent: { type: 'string' }, readerID: { type: 'string' },
            fault: { enum: ['malformed-permission', 'system-error'] }
          }, required: ['sessionID', 'readerID'], additionalProperties: false },
          output: { type: 'object' }
        } }
      }, { read: async ({ sessionID, seed, agent, readerID, fault }) => {
        const session = await ctx.session.get({ sessionID });
        if (session.location.directory !== ctx.location.directory ||
            session.metadata?.permissionFixture !== ${JSON.stringify(nonce)} ||
            session.metadata?.pstackWorker) throw new Error('Not a synthetic fixture session');
        const historyGates = [
          ['tools.pstack.history_read', '*'],
          ['pstack_history', ctx.location.directory],
        ];
        const gates = [
          ...historyGates,
          ['pstack_worker_review', resource],
          ...historyGates,
        ];
        try {
          for (const [action, resource] of gates) {
            evaluations.set(readerID, null);
            try {
              // Synthetic source IDs test the permission API, not real tool execution or provenance.
              await ctx.permission.assert({ sessionID, agent,
                source: { type: 'tool', messageID: 'synthetic-message-' + readerID, id: readerID },
                metadata: fault ? { fault } : {},
                action, resources: fault === 'malformed-permission' ? [null] : [resource],
                save: seed && action === 'pstack_worker_review' ? [resource] : [] });
            } catch (error) {
              const evaluation = evaluations.get(readerID);
              // Policy denials bypass the evaluate hook. Callers also verify the API decision.
              if (error._tag === 'Tool.Error' && error.message === 'Permission denied: ' + action) {
                return { released: false, deniedAction: action, decision: 'deny' };
              }
              if (evaluation?.action === action && evaluation.effect === 'ask' && error._tag === 'Permission.DeclinedError') {
                return { released: false, deniedAction: action, decision: 'reject' };
              }
              throw error;
            }
          }
          return { released: true, value: 'synthetic-no-data' };
        } finally {
          evaluations.delete(readerID);
        }
      } });
    }
  };`;
}

test('installed review permission prerequisite uses fresh approval and retains history denials', {
  skip: process.env.PSTACK_REVIEW_PERMISSION_TEST !== '1', timeout: 180000,
}, async t => {
  const root = await makeTempDir('pstack-review-permission-');
  t.diagnostic(`Isolated review fixture ${root}; removed after successful server cleanup`);
  let isolated;
  t.after(async () => {
    if (!isolated) return;
    await isolated.stop();
    await rm(root, { recursive: true, force: true });
  });
  isolated = await isolatedOpenCode(root, { signal: t.signal });
  const { api } = isolated;
  const server = await api('get', '/api/info');
  assert.equal(server.version, '2.0.32', 'BLOCKED. A different server version cannot prove 2.0.32 behavior');
  t.diagnostic(`Installed server ${server.version}; requested proof target 2.0.32`);
  await t.test('save empty alone does not override a configured allow', async () => {
    const baseline = `${root}/baseline`;
    await mkdir(baseline);
    await writeFile(`${baseline}/opencode.json`, JSON.stringify({ agents: {
      'fixture-baseline': { mode: 'primary', permissions: [
        { action: reviewAction, resource: '*', effect: 'allow' },
      ] },
    } }));
    const location = `?location%5Bdirectory%5D=${encodeURIComponent(baseline)}`;
    const readiness = AbortSignal.timeout(10000);
    while (!(await api('get', '/api/agent' + location, undefined, readiness)).data.some(agent => agent.id === 'fixture-baseline')) {
      await delay(100, undefined, { signal: readiness });
    }
    const { data: session } = await api('post', '/api/session', {
      agent: 'fixture-baseline', location: { directory: baseline },
      title: 'Synthetic no-data permission baseline',
    });
    assert.equal(session.agent, 'fixture-baseline');
    await isolated.verifyLocation(baseline);
    const { data: decision } = await api('post', `/api/session/${session.id}/permission`, {
      action: reviewAction, resources: [`${baseline}/synthetic-no-data`], save: [],
    });
    try {
      assert.equal(decision.effect, 'allow');
    } finally {
      if (decision.effect === 'ask') await api('post', `/api/session/${session.id}/permission/${decision.id}/reply`, { decision: 'reject' });
    }
  });
  const directory = `${root}/review`;
  await mkdir(directory);
  const nonce = randomUUID();
  const resource = `${directory}/synthetic-no-data`;
  const query = `?location%5Bdirectory%5D=${encodeURIComponent(directory)}`;
  const rule = (action, effect) => ({ action, resource: '*', effect });
  const allowed = [rule(historyTool, 'allow'), rule('pstack_history', 'allow'), rule(reviewAction, 'allow')];
  await mkdir(`${directory}/plugin`);
  await writeFile(`${directory}/plugin/package.json`, JSON.stringify({ type: 'module' }));
  await writeFile(`${directory}/plugin/index.js`, fixturePlugin(nonce));
  await writeFile(`${directory}/opencode.json`, JSON.stringify({
    plugins: ['./plugin'],
    agents: {
      'fixture-allow': { mode: 'primary', permissions: allowed },
      'fixture-review-deny': { mode: 'primary', permissions: [...allowed, rule(reviewAction, 'deny')] },
      'fixture-history-deny': { mode: 'primary', permissions: [...allowed, rule('pstack_history', 'deny')] },
      'fixture-tool-deny': { mode: 'primary', permissions: [...allowed, rule(historyTool, 'deny')] },
    },
  }));
  async function session(agent, permissions = []) {
    const { data } = await api('post', '/api/session', {
      agent, permissions, location: { directory }, metadata: { permissionFixture: nonce },
      title: 'Synthetic no-data review permission prerequisite',
    });
    assert.equal(data.location.directory, directory);
    assert.notEqual(data.projectID, 'global', 'Never save a global permission');
    return data;
  }
  const owner = await session('fixture-allow');
  await api('get', '/api/agent' + query);
  const readiness = AbortSignal.timeout(10000);
  let startupDiagnostic = 'No plugin response received';
  let readinessChecks = 0;
  try {
    while (true) {
      const plugins = (await api('get', '/api/plugin' + query, undefined, readiness)).data;
      readinessChecks++;
      const fixture = plugins.find(p => p.id === 'pstack.review-permission-fixture' ||
        (p.source.type === 'local' && (p.source.path === `${directory}/plugin` ||
          p.source.path.startsWith(`${directory}/plugin/`))));
      const status = fixture?.state.status;
      startupDiagnostic = JSON.stringify({ fixture: './plugin', checks: readinessChecks,
        pluginCount: plugins.length,
        status: ['active', 'failed'].includes(status) ? status : fixture ? 'unknown' : 'absent',
        errorReported: typeof fixture?.state.error === 'string' });
      assert.notEqual(status, 'failed', `Synthetic fixture plugin failed. ${startupDiagnostic}`);
      if (status === 'active') break;
      await delay(100, undefined, { signal: readiness });
    }
  } catch (error) {
    if (readiness.aborted) {
      assert.fail(`Synthetic fixture plugin was not active within 10 seconds. ${startupDiagnostic}`);
    }
    throw error;
  }
  t.diagnostic(`Synthetic fixture plugin active after ${readinessChecks} readiness checks`);
  await isolated.verifyLocation(directory);
  const pending = async (id, signal) => (await api('get', `/api/session/${id}/permission`, undefined, signal)).data;
  const reply = async (id, requestID, decision) => api('post', `/api/session/${id}/permission/${requestID}/reply`, { decision });
  const readers = new Set();
  const read = (id, options = {}) => {
    const reader = { id, controller: new AbortController() };
    reader.result = api('post', '/api/rpc/pstack-review-permission-fixture/read' + query,
      { input: { sessionID: id, seed: false, readerID: randomUUID(), agent: 'fixture-allow', ...options } }, reader.controller.signal)
      .then(response => response.output).finally(() => readers.delete(reader));
    readers.add(reader);
    reader.result.catch(() => {});
    return reader.result;
  };
  async function drainReads(id) {
    const active = [...readers].filter(reader => reader.id === id);
    try {
      for (const request of await pending(id)) await reply(id, request.id, 'reject');
    } finally {
      for (const reader of active) reader.controller.abort();
      await Promise.allSettled(active.map(reader => reader.result));
    }
  }
  async function assertDenied(id, action, result, options = {}) {
    assert.deepEqual(await result, { released: false, deniedAction: action, decision: 'deny' });
    const { data: decision } = await api('post', `/api/session/${id}/permission`, {
      agent: 'fixture-allow', ...options, action, save: [],
      source: { type: 'tool', messageID: 'synthetic-decision-message', id: randomUUID() },
      resources: [action === reviewAction ? resource : action === historyTool ? '*' : directory],
    });
    try {
      assert.equal(decision.effect, 'deny', 'An assertion failure is not enough to prove SDK policy denial');
    } finally {
      if (decision.effect === 'ask') await reply(id, decision.id, 'reject');
    }
  }
  async function waitForApproval(id, readerID, count = 1) {
    const deadline = AbortSignal.timeout(10000);
    for (let attempt = 0; attempt < 40; attempt++) {
      const requests = await pending(id, deadline);
      const request = readerID ? requests.find(p => p.source?.id === readerID) : requests[0];
      if (request) {
        assert.equal(requests.length, count);
        assert.equal(request.action, reviewAction);
        assert.deepEqual(request.resources, [resource]);
        assert.deepEqual(request.source, { type: 'tool', id: request.source.id,
          messageID: 'synthetic-message-' + request.source.id });
        return request;
      }
      await delay(100, undefined, { signal: deadline });
    }
    assert.fail('Synthetic read did not request fresh approval');
  }
  async function approvedRead(seed, decision, id = owner.id, options = {}) {
    let settled = false;
    const readerID = randomUUID();
    const result = read(id, { seed, readerID, ...options }).finally(() => { settled = true; });
    result.catch(() => {});
    try {
      const request = await waitForApproval(id, readerID);
      assert.equal(settled, false, 'No data may be released before approval');
      assert.deepEqual(request.save, seed ? [resource] : []);
      await reply(id, request.id, decision);
      assert.deepEqual(await result, { released: true, value: 'synthetic-no-data' });
      assert.deepEqual(await pending(id), []);
      return request.id;
    } finally {
      await drainReads(id);
      await result.catch(() => {});
    }
  }

  await t.test('configured allow still asks on repeated identical reads', async () => {
    const first = await approvedRead(false, 'once');
    const second = await approvedRead(false, 'once');
    assert.notEqual(first, second);
  });

  await t.test('saved allow still asks on every identical read, including an always reply with save empty', async () => {
    await approvedRead(true, 'always');
    const saved = (await api('get', `/api/permission/saved?projectID=${encodeURIComponent(owner.projectID)}`)).data;
    assert.ok(saved.some(p => p.projectID === owner.projectID && p.action === reviewAction && p.resource === resource));
    const first = await approvedRead(false, 'always');
    const second = await approvedRead(false, 'once');
    assert.notEqual(first, second);
  });

  await t.test('saving one approval does not release another pending identical read', async () => {
    const firstID = randomUUID();
    const secondID = randomUUID();
    let firstSettled = false;
    let secondSettled = false;
    const firstResult = read(owner.id, { seed: true, readerID: firstID })
      .finally(() => { firstSettled = true; });
    firstResult.catch(() => {});
    let secondResult;
    try {
      const first = await waitForApproval(owner.id, firstID);
      secondResult = read(owner.id, { readerID: secondID }).finally(() => { secondSettled = true; });
      secondResult.catch(() => {});
      const second = await waitForApproval(owner.id, secondID, 2);
      assert.deepEqual(first.save, [resource]);
      assert.deepEqual(second.save, []);
      assert.notEqual(first.id, second.id);
      assert.equal(firstSettled, false);
      assert.equal(secondSettled, false);
      await reply(owner.id, first.id, 'always');
      assert.deepEqual(await firstResult, { released: true, value: 'synthetic-no-data' });
      await delay(200);
      assert.equal(secondSettled, false, 'Always approval must release only the corresponding RPC reader');
      assert.deepEqual((await pending(owner.id)).map(p => p.id), [second.id]);
      await reply(owner.id, second.id, 'reject');
      assert.deepEqual(await secondResult, { released: false, deniedAction: reviewAction, decision: 'reject' });
      assert.deepEqual(await pending(owner.id), []);
    } finally {
      await drainReads(owner.id);
      await Promise.allSettled([firstResult, secondResult]);
    }
  });

  await t.test('review rejection releases no synthetic data', async () => {
    const result = read(owner.id);
    result.catch(() => {});
    try {
      const request = await waitForApproval(owner.id);
      await reply(owner.id, request.id, 'reject');
      assert.deepEqual(await result, { released: false, deniedAction: reviewAction, decision: 'reject' });
    } finally {
      await drainReads(owner.id);
      await result.catch(() => {});
    }
  });

  for (const [agent, action] of [
    ['fixture-review-deny', reviewAction],
    ['fixture-history-deny', 'pstack_history'],
    ['fixture-tool-deny', historyTool],
  ]) {
    await t.test(`${action} selected agent denial applies when execution agent is omitted`, async () => {
      const denied = await session(agent);
      await assertDenied(denied.id, action, read(denied.id, { agent: undefined }), { agent: undefined });
      assert.deepEqual(await pending(denied.id), []);
    });
    await t.test(`${action} explicit execution agent denial overrides allowing selected agent`, async () => {
      await assertDenied(owner.id, action, read(owner.id, { agent }), { agent });
      assert.deepEqual(await pending(owner.id), []);
    });
    await t.test(`${action} explicit allowing execution agent differs from denying selected agent`, async () => {
      const denied = await session(agent);
      await approvedRead(false, 'once', denied.id);
    });
    await t.test(`${action} session denial survives configured agent allow and a saved review grant`, async () => {
      const denied = await session('fixture-allow', [rule(action, 'deny')]);
      await assertDenied(denied.id, action, read(denied.id));
      assert.deepEqual(await pending(denied.id), []);
    });
  }

  for (const action of [historyTool, 'pstack_history']) {
    await t.test(`fixture post-approval recheck catches ${action} denial added while waiting`, async () => {
      const waiting = await session('fixture-allow');
      let settled = false;
      const result = read(waiting.id).finally(() => { settled = true; });
      result.catch(() => {});
      try {
        const request = await waitForApproval(waiting.id);
        await api('patch', `/api/session/${waiting.id}`, { permissions: [rule(action, 'deny')] });
        const updated = (await api('get', `/api/session/${waiting.id}`)).data;
        assert.deepEqual(updated.permissions, [rule(action, 'deny')]);
        assert.equal(settled, false);
        await reply(waiting.id, request.id, 'once');
        await assertDenied(waiting.id, action, result);
        assert.deepEqual(await pending(waiting.id), []);
      } finally {
        await drainReads(waiting.id);
        await result.catch(() => {});
      }
    });
  }

  for (const fault of ['malformed-permission', 'system-error']) {
    await t.test(`${fault} cannot masquerade as permission denial`, async () => {
      await assert.rejects(read(owner.id, { fault }), error => {
        assert.ok(error.status >= 400 && error.body, 'The fixture must report an HTTP RPC error, not a transport failure');
        const response = JSON.parse(error.body);
        assert.equal(response._tag, 'RpcInternalError');
        assert.equal(response.type, 'rpc.internal');
        return true;
      });
      assert.deepEqual(await pending(owner.id), []);
    });
  }
});
