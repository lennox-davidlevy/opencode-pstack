import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapLocalWorker } from '../plugins/pstack/local-worker-bootstrap.js';
import { makeTempDir } from './helpers/temp.js';

const source = fileURLToPath(new URL('../', import.meta.url));

test('local bootstrap preserves existing checkout configuration and symlink targets', async t => {
  for (const kind of ['directory', 'symlink']) {
    await t.test(kind, async () => {
      const root = await makeTempDir('pstack-local-bootstrap-');
      const checkout = join(root, 'checkout');
      await mkdir(checkout);
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
