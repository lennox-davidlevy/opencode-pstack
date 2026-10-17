import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, access, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import workerPlugin from '../internal/pstack-worker/index.js';
import { containerOptions } from '../plugins/pstack/containers.js';
import { makeTempDir } from './helpers/temp.js';
import { isolatedOpenCode } from './helpers/isolated-opencode.js';
import { ownedContainers } from './helpers/owned-container.js';

test('worker command enforces real parent agent denials and compound-script approval before execution',
  { skip: process.env.PSTACK_CONTAINER_TEST !== '1', timeout: 180000 }, async t => {
    const root = await makeTempDir('pstack-worker-permission-');
    t.diagnostic(`Isolated permission fixture ${root}; removed after successful resource cleanup`);
    const originalEnvironment = process.env;
    let server;
    let cleanupContainers;
    const containers = ownedContainers({ after: cleanup => { cleanupContainers = cleanup; } });
    t.after(async () => {
      try {
        const results = await Promise.allSettled([cleanupContainers(), server?.stop()]);
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (errors.length) throw new AggregateError(errors, `Cleanup failed; retained fixture ${root}`);
        if (server) await rm(root, { recursive: true, force: true });
      } finally { process.env = originalEnvironment; }
    });
    server = await isolatedOpenCode(root, { signal: t.signal });
    const { api } = server;
    // This file runs in its own node:test process. The real container adapter
    // inherits that process's environment, including Docker context and config.
    process.env = { ...server.env };
    const directory = `${root}/workspace`;
    await mkdir(directory);
    await writeFile(`${directory}/opencode.json`, JSON.stringify({ agents: {
      'permission-parent': { mode: 'primary', permissions: [{ action: 'shell', resource: 'touch *', effect: 'deny' }] },
      'permission-child': { mode: 'primary', permissions: [
        { action: 'shell', resource: '*', effect: 'allow' },
        { action: 'pstack_container_script', resource: '*', effect: 'ask' },
      ] },
    } }));
    const readiness = AbortSignal.timeout(10000);
    while (true) {
      const agents = (await api('get', `/api/agent?location%5Bdirectory%5D=${encodeURIComponent(directory)}`, undefined, readiness)).data;
      if (['permission-parent', 'permission-child'].every(id => agents.some(agent => agent.id === id))) break;
      await delay(100, undefined, { signal: readiness });
    }
    const parent = (await api('post', '/api/session', { agent: 'permission-parent', location: { directory } })).data;
    await server.verifyLocation(directory);
    const id = randomUUID();
    const child = (await api('post', '/api/session', { agent: 'permission-child', location: { directory }, metadata: { pstackWorker: id } })).data;
    assert.equal(parent.agent, 'permission-parent');
    assert.equal(child.agent, 'permission-child');
    const base = { id, owner: parent.id, directory, role: 'poteto-agent' };
    const worker = await containers.start(await containerOptions({}), base);
    let commandTool;
    // Registration adapter only. Permissions below are evaluated by the installed
    // OpenCode server; file/process effects use the real container executor.
    await workerPlugin.setup({
      options: { worker },
      tool: { transform: async register => register({ list: () => [], add: tool => { commandTool = tool; } }) },
      session: { get: async ({ sessionID }) => (await api('get', `/api/session/${sessionID}`)).data, hook: async () => {} },
      permission: { assert: async ({ sessionID, agent, action, resources }) => {
        const location = `?location%5Bdirectory%5D=${encodeURIComponent(directory)}`;
        const decision = (await api('post', `/api/session/${sessionID}/permission${location}`, { agent, action, resources })).data;
        if (decision.effect === 'ask') await api('post', `/api/session/${sessionID}/permission/${decision.id}/reply`, { decision: 'reject' });
        if (decision.effect !== 'allow') throw new Error(`${action}: ${decision.effect}`);
      } },
    });
    const context = { sessionID: child.id, agent: 'permission-child', signal: t.signal };
    await assert.rejects(commandTool.execute({ command: 'touch parent-denied.txt' }, context), /shell: deny/);
    await assert.rejects(access(`${directory}/parent-denied.txt`));
    await assert.rejects(commandTool.execute({ command: 'true && touch compound-denied.txt' }, context), /pstack_container_script: ask/);
    await assert.rejects(access(`${directory}/compound-denied.txt`));
    await assert.rejects(commandTool.execute({ command: 'touc"h" quoted-denied.txt' }, context), /pstack_container_script: ask/);
    await assert.rejects(access(`${directory}/quoted-denied.txt`));
    await assert.rejects(commandTool.execute({ command: 'touc\\h escaped-denied.txt' }, context), /pstack_container_script: ask/);
    await assert.rejects(access(`${directory}/escaped-denied.txt`));
    const permitted = await commandTool.execute({ command: 'pwd' }, context);
    assert.equal(JSON.parse(permitted.content).stdout.trim(), '/workspace');
  });
