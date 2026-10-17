import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import workerPlugin from '../plugins/pstack-worker/index.js';
import { api } from '../plugins/pstack/api.js';
import { containerOptions, startContainer, inspectContainer } from '../plugins/pstack/containers.js';
import { makeTempDir } from './helpers/temp.js';

test('worker command enforces real parent agent denials and compound-script approval before execution',
  { skip: process.env.PSTACK_CONTAINER_TEST !== '1', timeout: 120000 }, async () => {
    const directory = await makeTempDir('pstack-worker-permission-');
    await writeFile(`${directory}/opencode.json`, JSON.stringify({ agents: {
      'permission-parent': { mode: 'primary', permissions: [{ action: 'shell', resource: 'touch *', effect: 'deny' }] },
      'permission-child': { mode: 'primary', permissions: [
        { action: 'shell', resource: '*', effect: 'allow' },
        { action: 'pstack_container_script', resource: '*', effect: 'ask' },
      ] },
    } }));
    const parent = (await api('post', '/api/session', { agent: 'permission-parent', location: { directory } })).data;
    const id = randomUUID();
    const child = (await api('post', '/api/session', { agent: 'permission-child', location: { directory }, metadata: { pstackWorker: id } })).data;
    await api('get', `/api/agent?location%5Bdirectory%5D=${encodeURIComponent(directory)}`);
    const base = { id, owner: parent.id, directory, role: 'poteto-agent' };
    const worker = { ...base, ...await startContainer(await containerOptions({}), base) };
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
    const context = { sessionID: child.id, agent: 'permission-child', signal: new AbortController().signal };
    try {
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
    } finally { await inspectContainer(worker, true); }
  });
