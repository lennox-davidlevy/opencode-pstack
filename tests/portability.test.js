import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { makeTempDir } from './helpers/temp.js';
import { isolatedOpenCode } from './helpers/isolated-opencode.js';
import { bootstrapLocalWorker } from '../plugins/pstack/local-worker-bootstrap.js';

const source = fileURLToPath(new URL('../', import.meta.url));
const workerRoles = ['poteto', 'poteto-agent', 'poteto-reviewer', 'poteto-investigator'];

test('clean server loads Markdown roles in development, consuming-project, and local-worker layouts',
  { skip: process.env.PSTACK_PORTABILITY_TEST !== '1', timeout: 180000 }, async t => {
    const root = await makeTempDir('pstack-portability-');
    t.diagnostic(`Isolated installation fixture ${root}; removed after successful server cleanup`);
    let server;
    t.after(async () => {
      if (!server) return;
      await server.stop();
      await rm(root, { recursive: true, force: true });
    });
    const bundle = join(root, 'bundle');
    await mkdir(bundle);
    for (const path of ['agents', 'plugins', 'skills', 'prompts', 'opencode.json', 'package.json', 'package-lock.json']) {
      await cp(join(source, path), join(bundle, path), { recursive: true, verbatimSymlinks: true });
    }
    // Dependency installation is not under test. Reuse the exact installed SDK tree.
    await symlink(join(source, 'node_modules'), join(bundle, 'node_modules'), 'dir');
    await mkdir(join(bundle, '.opencode'));
    await cp(join(source, '.opencode/agents'), join(bundle, '.opencode/agents'), { verbatimSymlinks: true });
    const config = JSON.parse(await readFile(join(bundle, 'opencode.json'), 'utf8'));
    for (const server of Object.values(config.mcp.servers)) server.disabled = true;
    await writeFile(join(bundle, 'opencode.json'), JSON.stringify(config));
    const consumer = join(root, 'consumer');
    await mkdir(consumer);
    await cp(bundle, join(consumer, '.opencode'), { recursive: true, verbatimSymlinks: true });
    const worker = join(root, 'worker');
    await mkdir(worker);
    const restrictions = [{ action: 'subagent', resource: '*', effect: 'deny' }];
    await bootstrapLocalWorker(bundle, worker, restrictions);
    server = await isolatedOpenCode(root, { signal: t.signal });
    const info = await server.api('GET', '/api/info');
    assert.equal(info.version, '2.0.32');
    assert.equal(info.pid, server.pid, 'Requests must reach only the server owned by this test');
    assert.deepEqual((await server.api('GET', '/api/credential')).data, []);
    const expectedSkills = (await readdir(join(bundle, 'skills'))).filter(name => name.startsWith('pstack-')).sort();
    for (const [layout, directory] of [['development', bundle], ['consumer', consumer], ['local-worker', worker]]) {
      await t.test(layout, async () => {
        const query = '?' + new URLSearchParams({ 'location[directory]': directory });
        let agents;
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = await server.api('GET', '/api/agent' + query);
          assert.equal(result.location.directory, directory);
          agents = result.data;
          if (workerRoles.every(id => agents.some(a => a.id === id))) break;
          await delay(100);
        }
        const configuration = await server.api('GET', '/api/config' + query);
        assert.ok(configuration.every(entry => entry.path.startsWith(root + '/')), 'No ambient configuration source may load');
        await server.verifyLocation(directory);
        assert.equal(configuration.filter(entry => entry.info?.default_agent).at(-1)?.info.default_agent, 'poteto');
        for (const id of workerRoles) {
          const agent = agents.find(a => a.id === id);
          assert.ok(agent, `${id} must load without global agents`);
          const document = await readFile(join(bundle, 'agents', id + '.md'), 'utf8');
          const body = document.split(/^---\s*$/m)[2].trim();
          assert.equal(agent.system.trim(), body);
          assert.equal(agent.mode, id === 'poteto' ? 'primary' : 'subagent');
          assert.deepEqual(agent.model, { providerID: 'openai', id: 'gpt-6-astra', variant: 'high' });
        }
        for (const id of ['engineer', 'design', 'researcher', 'reviewer', 'build', 'plan']) {
          assert.ok(!agents.some(a => a.id === id), `unexpected inherited/disabled agent ${id}`);
        }
        let skills;
        for (let attempt = 0; attempt < 100; attempt++) {
          skills = (await server.api('GET', '/api/skill' + query)).data;
          if (skills.filter(s => s.id.startsWith('pstack-')).length === expectedSkills.length) break;
          await delay(100);
        }
        assert.deepEqual(skills.filter(s => s.id.startsWith('pstack-')).map(s => s.id).sort(), expectedSkills);
        let plugin;
        for (let attempt = 0; attempt < 100; attempt++) {
          plugin = (await server.api('GET', '/api/plugin' + query)).data.find(p => p.id === 'pstack.runtime');
          if (plugin?.state.status === 'active') break;
          await delay(100);
        }
        assert.equal(plugin?.state.status, 'active', JSON.stringify(plugin));
        const selectedAgent = layout === 'local-worker' ? 'poteto-agent' : 'poteto';
        const session = (await server.api('POST', '/api/session', { agent: selectedAgent, location: { directory },
          permissions: layout === 'local-worker' ? restrictions : [] })).data;
        assert.equal(session.agent, selectedAgent);
        for (const [agent, action, resource, expected] of [
          ['poteto', 'shell', 'git push origin HEAD', 'deny'],
          ['poteto', 'subagent', 'poteto-agent', layout === 'local-worker' ? 'deny' : 'allow'],
          ['poteto-reviewer', 'edit', '*', 'deny'],
          ['poteto-agent', 'subagent', 'poteto-reviewer', 'deny'],
          ['poteto-investigator', 'pstack_worker_review', '*', 'deny'],
        ]) {
          const decision = (await server.api('POST', `/api/session/${session.id}/permission`, { agent, action, resources: [resource], save: [] })).data;
          try { assert.equal(decision.effect, expected, `${agent} ${action}`); }
          finally { if (decision.effect === 'ask') await server.api('POST', `/api/session/${session.id}/permission/${decision.id}/reply`, { decision: 'reject' }); }
        }
      });
    }
    assert.deepEqual((await server.api('GET', '/api/credential')).data, []);
    for (const fault of ['missing', 'broken']) {
      await t.test(`development discovery rejects a ${fault} agent link`, async () => {
        const candidate = join(root, fault + '-link');
        await cp(bundle, candidate, { recursive: true, verbatimSymlinks: true,
          filter: path => path !== join(bundle, '.opencode/agents') });
        if (fault === 'broken') await symlink('../absent-agents', join(candidate, '.opencode/agents'), 'dir');
        const query = '?' + new URLSearchParams({ 'location[directory]': candidate });
        // Wait for location configuration, not merely an initially empty agent list.
        for (let attempt = 0; attempt < 100; attempt++) {
          const plugins = (await server.api('GET', '/api/plugin' + query)).data;
          if (plugins.some(p => p.id === 'pstack.runtime' && p.state.status === 'active')) break;
          if (attempt === 99) assert.fail('Fault fixture runtime did not activate');
          await delay(100);
        }
        const agents = (await server.api('GET', '/api/agent' + query)).data;
        await server.verifyLocation(candidate);
        assert.ok(workerRoles.every(id => !agents.some(agent => agent.id === id)),
          'Broken delivery must not be repaired by the test or hidden by global agents');
      });
    }
    t.diagnostic(`Separate owned server ${server.endpoint}; no model requests or credentials; MCP inventory disabled; installed dependencies reused.`);
  });
