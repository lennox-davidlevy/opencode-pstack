import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, link, lstat, mkdir, open, readFile, readdir, readlink, rename, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { captureRepository, workerManifest } from '../plugins/pstack/worker-artifacts.js';
import { WorkerHistory } from '../plugins/pstack/worker-history.js';
import { containerOptions, inspectContainer, startContainer } from '../plugins/pstack/containers.js';
import { makeTempDir } from './helpers/temp.js';

const exec = promisify(execFile);
const source = resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = async (directory, args) => (await exec('git', args, { cwd: directory,
  env: { PATH: process.env.PATH, HOME: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } })).stdout.trim();

async function fixture() {
  const parent = await makeTempDir('pstack-artifacts-test-');
  const directory = join(parent, 'checkout');
  await mkdir(directory);
  await git(directory, ['init', '--quiet']);
  const baseSHA = await git(source, ['rev-parse', 'HEAD']);
  // Existing commits only. The alternate store is contained so fixtures obey the same path boundary as workers.
  await cp(join(source, '.git/objects'), join(directory, '.git/fixture-objects'), { recursive: true });
  await writeFile(join(directory, '.git/objects/info/alternates'), '../fixture-objects\n');
  await git(directory, ['checkout', '--quiet', '--detach', baseSHA]);
  return { directory, baseSHA, parent };
}

async function corruptObject(f, oid, type, content) {
  const folder = join(f.directory, '.git/objects', oid.slice(0, 2));
  const path = join(folder, oid.slice(2));
  await mkdir(folder, { recursive: true });
  try { await rename(path, join(f.parent, `original-${oid}`)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(path, deflateSync(Buffer.concat([Buffer.from(`${type} ${content.length}\0`), content])), { flag: 'wx' });
}

function history(record) {
  return new WorkerHistory({ async get(key) { return key === 'worker/' + record.id ? structuredClone(record) : undefined; },
    async set() { throw new Error('Unexpected storage write'); }, async scan() { throw new Error('Unexpected scan'); } }, 'worker/');
}

async function inventory(directory) {
  const rows = [];
  async function walk(folder) {
    for (const name of (await readdir(folder)).sort()) {
      const path = join(folder, name);
      const stat = await lstat(path);
      rows.push([path, stat.mode, stat.mtimeMs, stat.isFile() ? hash(await readFile(path)) : stat.isSymbolicLink() ? hash(await readlink(path)) : null]);
      if (stat.isDirectory()) await walk(path);
    }
  }
  await walk(directory);
  return rows;
}

async function changes(f) {
  await writeFile(join(f.directory, 'README.md'), 'index-only secret bytes');
  await git(f.directory, ['add', '--', 'README.md']);
  await writeFile(join(f.directory, 'README.md'), 'working bytes');
  await rename(join(f.directory, 'opencode.json'), join(f.parent, 'deleted-opencode.json'));
  await chmod(join(f.directory, 'agents/reviewer.md'), 0o755);
  await writeFile(join(f.directory, 'new.txt'), 'untracked bytes');
  const target = join(f.parent, 'private-target');
  await writeFile(target, 'outside secret bytes');
  await symlink(target, join(f.directory, 'link'));
  await writeFile(join(f.directory, '.git/info/exclude'), 'ignored.txt\n');
  await writeFile(join(f.directory, 'ignored.txt'), 'ignored secret bytes');
  await writeFile(join(f.directory, 'index-only.txt'), 'staged addition bytes');
  await git(f.directory, ['add', '--', 'index-only.txt']);
  await rename(join(f.directory, 'index-only.txt'), join(f.parent, 'retained-index-only.txt'));
  return target;
}

test('repository observations describe tracked, untracked, deleted, executable, symlink and index-only changes without exporting bytes or mutating the checkout', async () => {
  const f = await fixture();
  const clean = await captureRepository(f.directory, f.baseSHA);
  assert.equal(clean.head, f.baseSHA);
  assert.deepEqual(clean.entries, []);
  assert.deepEqual(clean.staged, []);
  const target = await changes(f);
  const before = await inventory(f.directory);
  const observed = await captureRepository(f.directory, f.baseSHA);
  assert.deepEqual(await captureRepository(f.directory, f.baseSHA), observed);
  assert.deepEqual(await inventory(f.directory), before);
  assert.equal(observed.baseSHA, f.baseSHA);
  assert.deepEqual(observed.entries.map(entry => [entry.path, entry.status]), [
    ['README.md', 'modified'], ['agents/reviewer.md', 'modified'], ['link', 'added'], ['new.txt', 'added'], ['opencode.json', 'deleted'],
  ]);
  const byPath = new Map(observed.entries.map(entry => [entry.path, entry]));
  assert.deepEqual(byPath.get('README.md').after, { type: 'file', mode: '100644', sha256: hash('working bytes'), bytes: 13 });
  assert.equal(byPath.get('agents/reviewer.md').after.mode, '100755');
  assert.equal(byPath.get('agents/reviewer.md').before.sha256, byPath.get('agents/reviewer.md').after.sha256);
  assert.deepEqual(byPath.get('link').after, { type: 'symlink', mode: '120000', sha256: hash(target), bytes: Buffer.byteLength(target) });
  assert.equal(byPath.get('opencode.json').after, null);
  assert.equal(byPath.get('new.txt').tracked, false);
  assert.deepEqual(observed.excluded.ignored, ['ignored.txt']);
  assert.deepEqual(observed.excluded.untracked, []);
  assert.ok(observed.excluded.indexOnlyBlobs.includes('index-only.txt'));
  assert.deepEqual(observed.staged.map(entry => [entry.path, entry.indexOnly]), [['README.md', true], ['index-only.txt', true]]);
  assert.equal(observed.staged[0].index.sha256, hash('index-only secret bytes'));
  assert.equal(observed.indexDifferences.find(entry => entry.path === 'opencode.json').workingTree, null);
  for (const secret of [target, 'outside secret bytes', 'index-only secret bytes', 'ignored secret bytes', 'working bytes']) assert.ok(!JSON.stringify(observed).includes(secret));
  await writeFile(join(f.directory, 'new.txt'), 'different untracked bytes');
  assert.notDeepEqual(await captureRepository(f.directory, f.baseSHA), observed);
});

test('manifest rejects foreign owners, unknown IDs, other project scopes and local workers before inspecting a container', async () => {
  const record = { id: randomUUID(), owner: 'ses_owner', sessionID: 'ses_artifactWorker01', backend: 'local' };
  const workers = history(record);
  await assert.rejects(workerManifest(workers, 'ses_foreign', record.id), /not owned/);
  await assert.rejects(workerManifest(workers, record.owner, randomUUID()), /not owned/);
  await assert.rejects(workerManifest(new WorkerHistory(workers.storage, 'other/'), record.owner, record.id), /not owned/);
  await assert.rejects(workerManifest(workers, record.owner, record.id), /do not support local/);
});

test('corrupted Git objects cannot redefine the trusted baseline or indexed content', async t => {
  for (const kind of ['base blob', 'index blob', 'base tree', 'nested tree', 'base commit', 'ancestor commit']) {
    await t.test(kind, async () => {
      const f = await fixture();
      let oid;
      let type;
      let content;
      if (kind.endsWith('blob')) {
        if (kind === 'index blob') {
          await writeFile(join(f.directory, 'README.md'), 'indexed original');
          await git(f.directory, ['add', '--', 'README.md']);
        }
        oid = await git(f.directory, ['rev-parse', kind === 'index blob' ? ':README.md' : `${f.baseSHA}:README.md`]);
        type = 'blob';
        content = Buffer.from('tampered baseline and working content');
        await writeFile(join(f.directory, 'README.md'), content);
      } else {
        type = kind.endsWith('tree') ? 'tree' : 'commit';
        const revision = kind === 'base tree' ? `${f.baseSHA}^{tree}` : kind === 'nested tree' ? `${f.baseSHA}:agents`
          : kind === 'ancestor commit' ? `${f.baseSHA}^` : f.baseSHA;
        oid = await git(f.directory, ['rev-parse', revision]);
        const original = (await exec('git', ['cat-file', type, oid], { cwd: f.directory, encoding: 'buffer' })).stdout;
        content = Buffer.from(original);
        if (type === 'tree') {
          const mode = content.indexOf(Buffer.from('100644 '));
          assert.ok(mode >= 0);
          content.write('100755 ', mode);
        } else content = Buffer.concat([content, Buffer.from('\ntampered commit message\n')]);
      }
      await corruptObject(f, oid, type, content);
      await assert.rejects(captureRepository(f.directory, f.baseSHA), /Git.*(integrity|read failed)|object.*(integrity|mismatch)/i);
    });
  }
});

test('a tracked file replaced by a symlink reports the type change without reading its target', async () => {
  const f = await fixture();
  const original = await readFile(join(f.directory, 'README.md'));
  const target = join(f.parent, 'private-target');
  await writeFile(target, 'private target bytes');
  await rename(join(f.directory, 'README.md'), join(f.parent, 'original-README.md'));
  await symlink(target, join(f.directory, 'README.md'));
  const observed = await captureRepository(f.directory, f.baseSHA);
  assert.deepEqual(observed.entries, [{ path: 'README.md', status: 'modified', tracked: true,
    before: { type: 'file', mode: '100644', sha256: hash(original), bytes: original.length },
    after: { type: 'symlink', mode: '120000', sha256: hash(target), bytes: Buffer.byteLength(target) } }]);
  await writeFile(target, 'different private bytes');
  assert.deepEqual(await captureRepository(f.directory, f.baseSHA), observed);
});

test('the requested base stays distinct from the observed HEAD without creating commits', async () => {
  const f = await fixture();
  const previous = await git(source, ['rev-parse', 'HEAD^']);
  await git(f.directory, ['checkout', '--quiet', '--detach', previous]);
  const observed = await captureRepository(f.directory, f.baseSHA);
  assert.equal(observed.baseSHA, f.baseSHA);
  assert.equal(observed.head, previous);
  assert.notEqual(observed.head, observed.baseSHA);
  assert.deepEqual(observed.staged, []);
});

test('renames are represented as deletion and addition, not similarity guesses', async () => {
  const f = await fixture();
  await rename(join(f.directory, 'README.md'), join(f.directory, 'renamed.txt'));
  const observed = await captureRepository(f.directory, f.baseSHA);
  assert.deepEqual(observed.entries.map(entry => [entry.path, entry.status]), [['README.md', 'deleted'], ['renamed.txt', 'added']]);
  assert.deepEqual(observed.entries[0].before, observed.entries[1].after);
});

test('untrusted Git configuration cannot invoke helpers or include external configuration', async () => {
  const f = await fixture();
  const original = await readFile(join(f.directory, '.git/config'));
  const marker = join(f.parent, 'helper-was-run');
  for (const config of [
    `[core]\n fsmonitor = touch ${marker}\n`,
    `[diff]\n external = touch ${marker}\n`,
    `[diff "evil"]\n textconv = touch ${marker}\n`,
    `[include]\n path = ${join(f.parent, 'external-config')}\n`,
    `[core]\n worktree = ${f.parent}\n`,
    '[extensions]\n partialclone = origin\n',
  ]) {
    await writeFile(join(f.directory, '.git/config'), Buffer.concat([original, Buffer.from(config)]));
    await assert.rejects(captureRepository(f.directory, f.baseSHA), /Unsupported worker Git configuration/);
    await assert.rejects(lstat(marker), { code: 'ENOENT' });
  }
});

test('repository metadata indirections and unsafe paths fail closed', async t => {
  const cases = [
    ['external alternate', async f => writeFile(join(f.directory, '.git/objects/info/alternates'), join(source, '.git/objects') + '\n'), /alternate escapes/],
    ['metadata symlink', async f => symlink(join(f.parent, 'private'), join(f.directory, '.git/refs/escape')), /metadata symlink/],
    ['commondir', async f => writeFile(join(f.directory, '.git/commondir'), f.parent), /Git indirection/],
    ['symbolic ref escape', async f => writeFile(join(f.directory, '.git/HEAD'), 'ref: refs/../../private\n'), /Unsupported artifact path/],
    ['gitfile', async f => { await rename(join(f.directory, '.git'), join(f.parent, 'retained-git')); await writeFile(join(f.directory, '.git'), `gitdir: ${join(f.parent, 'retained-git')}\n`); }, /Standalone/],
    ['control-character path', async f => writeFile(join(f.directory, 'unsafe\nname'), 'x'), /Unsupported artifact path/],
    ['non-UTF-8 path', async f => writeFile(Buffer.concat([Buffer.from(f.directory + '/'), Buffer.from([255])]), 'x'), /non-UTF-8/],
    ['FIFO', async f => exec('mkfifo', [join(f.directory, 'fifo')]), /Unsupported artifact file type/],
    ['hard link', async f => { await writeFile(join(f.parent, 'outside'), 'private'); await link(join(f.parent, 'outside'), join(f.directory, 'hardlink')); }, /hard link/],
    ['submodule', async f => git(f.directory, ['update-index', '--add', '--cacheinfo', `160000,${f.baseSHA},submodule`]), /submodule/],
  ];
  for (const [name, prepare, error] of cases) await t.test(name, async () => {
    const f = await fixture();
    await prepare(f);
    await assert.rejects(captureRepository(f.directory, f.baseSHA), error);
  });
});

test('file size, aggregate bytes and path count limits reject instead of returning partial manifests', async t => {
  for (const [name, count, size] of [['file size', 1, 8 * 1024 * 1024 + 1], ['aggregate bytes', 9, 8 * 1024 * 1024], ['metadata bytes', 1, 64 * 1024 * 1024 + 1], ['path count', 10001, 0]]) {
    await t.test(name, async () => {
      const f = await fixture();
      for (let i = 0; i < count; i++) {
        const file = await open(join(f.directory, name === 'metadata bytes' ? '.git' : '', `bounded-${i}`), 'wx');
        await file.truncate(size);
        await file.close();
      }
      await assert.rejects(captureRepository(f.directory, f.baseSHA), /limit exceeded/);
    });
  }
});

test('stopped Docker workers produce stable metadata digests; running and foreign containers are rejected without stopping them',
  { skip: process.env.PSTACK_CONTAINER_TEST !== '1', timeout: 120000 }, async () => {
    const f = await fixture();
    await changes(f);
    const options = await containerOptions({});
    const base = { id: randomUUID(), owner: 'ses_artifact_owner', sessionID: 'ses_artifactWorker01', backend: 'container', role: 'poteto-agent', directory: f.directory, ref: f.baseSHA };
    const record = { ...base, ...await startContainer(options, base) };
    const workers = history(record);
    try {
      await assert.rejects(workerManifest(workers, record.owner, record.id), /requires a stopped container/);
      assert.equal((await inspectContainer(record)).state, 'running');
      const foreign = { ...record, owner: 'ses_other' };
      await assert.rejects(workerManifest(history(foreign), foreign.owner, foreign.id), /ownership mismatch/);
      assert.equal((await inspectContainer(record)).state, 'running');
    } finally { await inspectContainer(record, true); }
    const before = await inventory(f.directory);
    const first = await workerManifest(workers, record.owner, record.id);
    const second = await workerManifest(workers, record.owner, record.id);
    assert.equal(first.version, 1);
    assert.deepEqual(first.worker, base);
    assert.equal(first.baseSHA, f.baseSHA);
    assert.equal(first.head, f.baseSHA);
    assert.equal(first.artifactDigest, second.artifactDigest);
    assert.match(first.artifactDigest, /^[a-f0-9]{64}$/);
    assert.equal(first.container.state, 'exited');
    assert.deepEqual(await inventory(f.directory), before);
    const copiedDirectory = join(f.parent, 'same-artifacts');
    await cp(f.directory, copiedDirectory, { recursive: true });
    for (const identity of [{ sessionID: 'ses_artifactWorker02' }, { directory: copiedDirectory }, { role: 'poteto-reviewer' }, { role: undefined }]) {
      const changedIdentity = await workerManifest(history({ ...record, ...identity }), record.owner, record.id);
      assert.deepEqual(changedIdentity.entries, first.entries);
      assert.deepEqual(changedIdentity.staged, first.staged);
      assert.notEqual(changedIdentity.artifactDigest, first.artifactDigest);
      if ('role' in identity && identity.role === undefined) assert.equal(changedIdentity.worker.role, null);
    }
    await assert.rejects(workerManifest(history({ ...record, sessionID: undefined }), record.owner, record.id), /session ID/);
    await writeFile(join(f.directory, 'README.md'), 'different staged-only bytes');
    await git(f.directory, ['add', '--', 'README.md']);
    await writeFile(join(f.directory, 'README.md'), 'working bytes');
    const stagedChange = await workerManifest(workers, record.owner, record.id);
    assert.deepEqual(stagedChange.entries, first.entries);
    assert.notDeepEqual(stagedChange.staged, first.staged);
    assert.notEqual(stagedChange.artifactDigest, first.artifactDigest);
    await writeFile(join(f.directory, 'new.txt'), 'changed after capture');
    const changed = await workerManifest(workers, record.owner, record.id);
    assert.notEqual(changed.artifactDigest, stagedChange.artifactDigest);
    assert.equal((await inspectContainer(record)).state, 'exited');
  });
