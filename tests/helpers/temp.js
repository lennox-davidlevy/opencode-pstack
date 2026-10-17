import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTempDir(prefix, preferredParent = '/tmp/opencode') {
  return mkdtemp(join(existsSync(preferredParent) ? preferredParent : tmpdir(), prefix));
}
