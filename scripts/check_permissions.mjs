#!/usr/bin/env node
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { isolatedOpenCode } from '../tests/helpers/isolated-opencode.js';
import { makeTempDir } from '../tests/helpers/temp.js';

const source = fileURLToPath(new URL('../', import.meta.url));
const defaults = ['poteto', 'poteto-agent', 'poteto-reviewer', 'poteto-investigator'];
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('Usage: check_permissions.mjs [--agents AGENT [AGENT ...]]');
  process.exit(0);
}
if (args.length && (args[0] !== '--agents' || args.length < 2 || args.slice(1).some(arg => arg.startsWith('-')))) {
  console.error('Usage: check_permissions.mjs [--agents AGENT [AGENT ...]]');
  process.exit(2);
}
const agents = args.length ? args.slice(1) : defaults;

async function main() {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(180000)]);
  const interrupt = () => { process.exitCode = 130; cancellation.abort(new Error('Interrupted')); };
  const terminate = () => { process.exitCode = 143; cancellation.abort(new Error('Terminated')); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  let server;
  let root;
  try {
    root = await makeTempDir('pstack-permissions-');
    const directory = join(root, 'project');
    const configuration = join(directory, '.opencode');
    await mkdir(join(configuration, 'agents'), { recursive: true });
    const config = JSON.parse(await readFile(join(source, 'opencode.json'), 'utf8'));
    await writeFile(join(configuration, 'opencode.json'), JSON.stringify({
      default_agent: config.default_agent,
      permissions: config.permissions,
      agents: Object.fromEntries(Object.entries(config.agents).map(([id, agent]) => [id, { disabled: agent.disabled }])),
      update: 'disable', skills: [], plugins: [], mcp: { servers: {} },
    }));
    for (const entry of await readdir(join(source, 'agents'), { withFileTypes: true })) {
      if (!entry.name.endsWith('.md')) continue;
      assert.ok(entry.isFile(), `Agent fixture must be a regular file: ${entry.name}`);
      await copyFile(join(source, 'agents', entry.name), join(configuration, 'agents', entry.name));
    }
    signal.throwIfAborted();
    server = await isolatedOpenCode(root, { signal });
    const query = '?' + new URLSearchParams({ 'location[directory]': directory });
    let loaded;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await server.api('GET', '/api/agent' + query);
      assert.equal(result.location.directory, directory);
      loaded = result.data;
      if (agents.every(id => loaded.some(agent => agent.id === id))) break;
      await delay(100, undefined, { signal });
    }
    for (const id of agents) assert.ok(loaded.some(agent => agent.id === id), `Missing fixture agent: ${id}`);
    const sources = await server.api('GET', '/api/config' + query);
    assert.ok(sources.every(entry => entry.path.startsWith(root + '/')), 'No ambient configuration may load');
    await server.verifyLocation(directory);
    assert.deepEqual((await server.api('GET', '/api/credential')).data, []);
    let count = 0;
    for (const agent of agents) {
      const writer = ['poteto', 'poteto-agent'].includes(agent);
      const investigator = agent === 'poteto-investigator';
      const session = (await server.api('POST', '/api/session', {
        title: `pstack permission check ${agent}`, agent, location: { directory },
      })).data;
      const cases = [
        ['skill', 'pstack-poteto-mode', 'allow'],
        ['skill', 'pstack-runtime', 'allow'],
        ['skill', 'effect', 'allow'],
        ['edit', 'example.txt', writer ? 'allow' : 'deny'],
        ['execute', '*', 'allow'],
        ['shell', 'git commit -m example', writer ? 'ask' : 'deny'],
        ['shell', 'git push origin HEAD', writer ? 'ask' : 'deny'],
        ['shell', 'rm -rf example', writer ? 'ask' : 'deny'],
        ['shell', 'python3 -c "print(1)"', writer ? 'allow' : 'deny'],
        ['pstack_history', '*', 'allow'],
        ['pstack_schedule', '*', agent === 'poteto' ? 'ask' : 'deny'],
        ['pstack_worker', '*', agent === 'poteto' ? 'ask' : 'deny'],
        ['pstack_worker_review', '*', agent === 'poteto' ? 'ask' : 'deny'],
        ['pstack_terminal', '*', writer ? 'ask' : 'deny'],
        ['subagent', 'poteto-agent', agent === 'poteto' ? 'allow' : 'deny'],
        ['subagent', 'poteto-investigator', agent === 'poteto' ? 'allow' : 'deny'],
        ['subagent', 'general', 'deny'],
        ['context7_query-docs', '*', writer || investigator ? 'allow' : 'deny'],
        ['example_mcp_search', '*', investigator ? 'ask' : agent === 'poteto-reviewer' ? 'deny' : 'allow'],
      ];
      for (const [action, resource, expected] of cases) {
        const result = (await server.api('POST', `/api/session/${session.id}/permission`, {
          agent, action, resources: [resource],
        })).data;
        try {
          assert.equal(result.effect, expected, `${agent}: ${action} ${resource}`);
        } finally {
          if (result.effect === 'ask') {
            await server.api('POST', `/api/session/${session.id}/permission/${result.id}/reply`, { decision: 'reject' });
          }
        }
        count++;
      }
      console.log(`PASS ${agent}: ${cases.length} runtime permission checks`);
    }
    assert.deepEqual((await server.api('GET', '/api/credential')).data, []);
    console.log(`PASS ${count} decisions; no tested action executed`);
  } finally {
    try {
      await server?.stop();
      if (root && server) await rm(root, { recursive: true, force: true });
      else if (root) console.error(`Startup did not complete; retained fixture ${root}`);
    }
    finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode ||= 1;
});
