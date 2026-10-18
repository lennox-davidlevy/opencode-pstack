import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { makeTempDir } from './helpers/temp.js';
import { isolatedOpenCode } from './helpers/isolated-opencode.js';
import { bootstrapLocalWorker } from '../plugins/pstack/local-worker-bootstrap.js';
import { loadModelPolicy, resolveModel } from '../plugins/pstack/models.js';

const source = fileURLToPath(new URL('../', import.meta.url));
const workerRoles = ['poteto', 'poteto-agent', 'poteto-reviewer', 'poteto-investigator'];
const expectedRoleModels = {
  poteto: { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'high' },
  'poteto-agent': { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'high' },
  'poteto-reviewer': { providerID: 'openai', id: 'gpt-6-astra', variant: 'high' },
  'poteto-investigator': { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'medium' },
};

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
    for (const path of ['agents', 'plugins', 'internal', 'skills', 'prompts', 'pstack-models.json', 'opencode.json', 'package.json', 'package-lock.json']) {
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
        const mcp = (await server.api('GET', '/api/mcp' + query)).data;
        assert.deepEqual(mcp.map(server => server.name).sort(), Object.keys(config.mcp.servers).sort());
        assert.ok(mcp.every(server => server.status.status === 'disabled'));
        assert.equal(configuration.filter(entry => entry.info?.default_agent).at(-1)?.info.default_agent, 'poteto');
        for (const id of workerRoles) {
          const agent = agents.find(a => a.id === id);
          assert.ok(agent, `${id} must load without global agents`);
          const document = await readFile(join(bundle, 'agents', id + '.md'), 'utf8');
          const body = document.split(/^---\s*$/m)[2].trim();
          assert.equal(agent.system.trim(), body);
          assert.equal(agent.mode, id === 'poteto' ? 'primary' : 'subagent');
          assert.deepEqual(agent.model, expectedRoleModels[id]);
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
          if (layout === 'local-worker') break;
          if (plugin?.state.status === 'active') break;
          await delay(100);
        }
        if (layout === 'local-worker') {
          assert.equal(plugin, undefined, 'Local workers must not load the parent runtime');
          const generated = configuration.find(entry => entry.path === join(directory, '.opencode/opencode.json'));
          assert.ok(generated, 'Generated worker configuration must load');
          for (const service of ['snapshots', 'lsp', 'formatter']) assert.equal(generated.info[service], false);
        } else assert.equal(plugin?.state.status, 'active', JSON.stringify(plugin));
        const loadedPlugins = (await server.api('GET', '/api/plugin' + query)).data;
        assert.ok(!loadedPlugins.some(plugin => plugin.id === 'pstack.container-worker'),
          `${layout} must not load the container-only plugin`);
        assert.deepEqual(loadedPlugins.filter(plugin => plugin.state.status === 'failed').map(plugin => plugin.id), [],
          `${layout} must not have failed plugins`);
        const selectedAgent = layout === 'local-worker' ? 'poteto-agent' : 'poteto';
        const session = (await server.api('POST', '/api/session', { agent: selectedAgent, location: { directory },
          permissions: layout === 'local-worker' ? restrictions : [] })).data;
        assert.equal(session.agent, selectedAgent);
        for (const [agent, action, resource, expected] of [
          ['poteto', 'shell', 'git push origin HEAD', 'ask'],
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
    await t.test('dedicated worker location eviction preserves parent queries and empty history access', async () => {
      const session = (await server.api('POST', '/api/session', {
        agent: 'poteto-agent', location: { directory: worker }, permissions: restrictions,
      })).data;
      const query = '?' + new URLSearchParams({ 'location[directory]': worker });
      const loaded = async () => (await server.api('GET', '/api/debug/location')).map(location => location.directory);
      for (let cycle = 0; cycle < 3; cycle++) {
        await server.api('GET', '/api/agent' + query);
        assert.ok((await loaded()).includes(worker));
        assert.ok((await loaded()).includes(bundle));
        await server.api('DELETE', '/api/debug/location' + query);
        const remaining = await loaded();
        assert.ok(!remaining.includes(worker), 'Dedicated worker services must be evicted');
        assert.ok(remaining.includes(bundle), 'Parent location must remain loaded');
        const parentQuery = '?' + new URLSearchParams({ 'location[directory]': bundle });
        const parentAgents = (await server.api('GET', '/api/agent' + parentQuery)).data;
        assert.deepEqual(parentAgents.find(agent => agent.id === 'poteto').model, expectedRoleModels.poteto);
        const parentPlugins = (await server.api('GET', '/api/plugin' + parentQuery)).data;
        assert.equal(parentPlugins.find(plugin => plugin.id === 'pstack.runtime')?.state.status, 'active');
        assert.deepEqual((await server.api('GET', `/api/session/${session.id}/message`)).data, []);
        assert.ok(!(await loaded()).includes(worker), 'History access must not reload worker services');
      }
    });
    await t.test('policy references persist on real sessions without prompts or model calls', async () => {
      const policy = await loadModelPolicy(bundle);
      const parent = (await server.api('POST', '/api/session', { agent: 'poteto', location: { directory: bundle },
        model: { providerID: 'openai', id: 'gpt-6-astra', variant: 'high' } })).data;
      const expectedTasks = {
        coordination: { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'high' },
        implementation: { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'high' },
        hard: { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'xhigh' },
        investigation: { providerID: 'openai', id: 'gpt-6.1-sol', variant: 'medium' },
        review: { providerID: 'openai', id: 'gpt-6-astra', variant: 'high' },
        mechanical: { providerID: 'openai', id: 'gpt-5.3-codex-spark', variant: 'high' },
      };
      for (const [role, task, expected] of [
        ...Object.entries(expectedRoleModels).map(([role, model]) => [role, undefined, model]),
        ...Object.entries(expectedTasks).map(([task, model]) => ['poteto-agent', task, model]),
      ]) {
        const { model } = resolveModel(policy, role, task);
        const created = (await server.api('POST', '/api/session', { agent: role, model, location: { directory: bundle } })).data;
        assert.deepEqual(created.model, expected);
        const persisted = (await server.api('GET', `/api/session/${created.id}`)).data;
        assert.deepEqual(persisted.model, expected);
        assert.equal(persisted.agent, role);
        assert.deepEqual((await server.api('GET', `/api/session/${created.id}/message`)).data, []);
      }
      assert.deepEqual((await server.api('GET', `/api/session/${parent.id}`)).data.model,
        { providerID: 'openai', id: 'gpt-6-astra', variant: 'high' });
    });
    const owner = (await server.api('POST', '/api/session', { agent: 'poteto', location: { directory: bundle } })).data;
    for (const withWorker of [true, false]) {
      await t.test(`explicit container plugin ${withWorker ? 'activates with an owned worker' : 'rejects missing worker options'}`, async () => {
        const directory = join(root, withWorker ? 'container-control' : 'missing-worker-control');
        await mkdir(directory);
        // Loading needs an owned worker identity, but does not start or execute a container.
        const worker = { id: randomUUID(), owner: owner.id, directory, backend: 'container', role: 'poteto-agent' };
        await writeFile(join(directory, 'opencode.json'), JSON.stringify({
          plugins: [{ package: join(bundle, 'internal/pstack-worker'), ...(withWorker ? { options: { worker } } : {}) }],
        }));
        const query = '?' + new URLSearchParams({ 'location[directory]': directory });
        let plugin;
        for (let attempt = 0; attempt < 100; attempt++) {
          plugin = (await server.api('GET', '/api/plugin' + query)).data.find(p => p.id === 'pstack.container-worker');
          if (['active', 'failed'].includes(plugin?.state.status)) break;
          await delay(100);
        }
        await server.verifyLocation(directory);
        assert.equal(plugin?.state.status, withWorker ? 'active' : 'failed', JSON.stringify(plugin));
        if (!withWorker) assert.match(plugin.state.error, /Missing owned worker/);
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
