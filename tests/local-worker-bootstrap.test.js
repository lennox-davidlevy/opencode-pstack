import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Config } from '@opencode/schema/config';
import { Schema } from 'effect';
import { bootstrapLocalWorker } from '../plugins/pstack/local-worker-bootstrap.js';
import { makeTempDir } from './helpers/temp.js';

const roles = ['poteto', 'poteto-agent', 'poteto-reviewer', 'poteto-investigator'];

async function fixture(t) {
  const root = await makeTempDir('pstack-local-bootstrap-');
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await assert.rejects(readdir(root), { code: 'ENOENT' });
  });
  const source = join(root, 'assets');
  const checkout = join(root, 'checkout');
  await mkdir(join(source, 'agents'), { recursive: true });
  await mkdir(join(source, 'skills'));
  await mkdir(checkout);
  const permissions = [
    { action: 'skill', resource: '*', effect: 'deny' },
    { action: 'skill', resource: 'pstack-*', effect: 'allow' },
    { action: 'shell', resource: '*', effect: 'allow' },
    { action: 'shell', resource: 'git push *', effect: 'deny' },
  ];
  const bundled = {
    $schema: 'https://opencode.ai/config.json',
    default_agent: 'poteto',
    skills: ['./skills'],
    plugins: ['./plugins/pstack', './parent-only-plugin'],
    permissions,
    snapshots: true,
    lsp: { custom: { command: ['parent-lsp'] } },
    formatter: { custom: { command: ['parent-formatter'] } },
    websearch: { provider: 'random' },
    mcp: { servers: {
      playwright: { type: 'local', command: ['parent-playwright'] },
      context7: { type: 'remote', url: 'https://example.invalid/mcp' },
      custom: { type: 'local', command: ['parent-custom'] },
    } },
    agents: {
      build: { disabled: true },
      plan: { disabled: true },
      'parent-only': { description: 'Do not carry enabled parent roles' },
      'poteto-agent': { model: 'parent/model', permissions: [] },
    },
  };
  await writeFile(join(source, 'opencode.json'), JSON.stringify(bundled));
  const markdown = Object.fromEntries(roles.map(role => [role,
    `---\nmodel: fixture/${role}#high\nmode: subagent\npermissions:\n  - { action: subagent, resource: "*", effect: deny }\n---\nAuthoritative ${role}.\n`]));
  for (const role of roles) await writeFile(join(source, 'agents', role + '.md'), markdown[role]);
  return { root, source, checkout, bundled, markdown };
}

test('local bootstrap writes only worker configuration and preserves authoritative role permissions', async t => {
  const { source, checkout, bundled, markdown } = await fixture(t);
  const restrictions = [
    { action: 'subagent', resource: '*', effect: 'deny' },
    { action: 'external_directory', resource: '*', effect: 'deny' },
    { action: 'shell', resource: 'git commit *', effect: 'deny' },
  ];
  const originalRestrictions = structuredClone(restrictions);
  await bootstrapLocalWorker(source, checkout, restrictions);

  const directory = join(checkout, '.opencode');
  const config = JSON.parse(await readFile(join(directory, 'opencode.json'), 'utf8'));
  Schema.decodeUnknownSync(Config.Info)(config);
  assert.deepEqual(config, {
    $schema: 'https://opencode.ai/config.json',
    default_agent: 'poteto',
    skills: [join(source, 'skills')],
    plugins: [],
    permissions: bundled.permissions,
    snapshots: false,
    lsp: false,
    formatter: false,
    mcp: { servers: {
      playwright: { type: 'local', command: ['parent-playwright'], disabled: true },
      context7: { type: 'remote', url: 'https://example.invalid/mcp', disabled: true },
      custom: { type: 'local', command: ['parent-custom'], disabled: true },
    } },
    agents: {
      build: { disabled: true },
      plan: { disabled: true },
      ...Object.fromEntries(roles.map(role => [role, { permissions: [
        { action: 'external_directory', resource: join(source, 'skills') + '/**', effect: 'allow' },
        ...originalRestrictions,
      ] }])),
    },
  });
  assert.deepEqual((await readdir(directory)).sort(), ['agents', 'opencode.json']);
  assert.deepEqual((await readdir(join(directory, 'agents'))).sort(), roles.map(role => role + '.md').sort());
  for (const role of roles) {
    assert.equal(await readFile(join(directory, 'agents', role + '.md'), 'utf8'), markdown[role]);
    assert.equal(await readFile(join(source, 'agents', role + '.md'), 'utf8'), markdown[role]);
  }
  assert.deepEqual(JSON.parse(await readFile(join(source, 'opencode.json'), 'utf8')), bundled);
  assert.deepEqual(restrictions, originalRestrictions);
});

test('local bootstrap preserves existing checkout configuration and symlink targets', async t => {
  for (const kind of ['directory', 'symlink']) {
    await t.test(kind, async t => {
      const { root, source, checkout } = await fixture(t);
      const target = kind === 'directory' ? join(checkout, '.opencode') : join(root, 'external');
      await mkdir(target);
      await writeFile(join(target, 'opencode.json'), '{"sentinel":true}');
      if (kind === 'symlink') await symlink(target, join(checkout, '.opencode'), 'dir');
      await assert.rejects(bootstrapLocalWorker(source, checkout, []), { code: 'EEXIST' });
      assert.equal(await readFile(join(target, 'opencode.json'), 'utf8'), '{"sentinel":true}');
      assert.deepEqual(await readdir(target), ['opencode.json']);
    });
  }
});
