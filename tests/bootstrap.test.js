import assert from 'node:assert/strict';
import { accessSync, constants, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = new URL('../skills/pstack-poteto-mode/scripts/', import.meta.url);

test('bundled orchestration entrypoints are executable Bun scripts', () => {
  for (const name of ['orch/orch.ts', 'watch-pr/watch-pr', 'worktree-audit.sh']) {
    const path = fileURLToPath(new URL(name, scripts));
    accessSync(path, constants.X_OK);
    assert.match(readFileSync(path, 'utf8').split('\n')[0], /^#!/);
  }
});
