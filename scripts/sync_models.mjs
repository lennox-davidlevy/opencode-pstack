import { constants, lstat, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadModelPolicy, modelRoles } from '../plugins/pstack/models.js';

const root = fileURLToPath(new URL('../', import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/sync_models.mjs [--check]');
  const check = args.includes('--check');
  const policy = await loadModelPolicy(root);
  const directory = join(root, 'agents');
  if (!(await lstat(directory)).isDirectory()) throw new Error('Refusing a symlink or non-directory agents path');
  const changes = [];
  for (const role of modelRoles) {
    const path = join(directory, role + '.md');
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error(`Refusing a symlink or non-file agent: ${path}`);
    if (stat.nlink !== 1) throw new Error(`Refusing a hardlinked agent: ${path}`);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let text;
    try { text = await file.readFile('utf8'); }
    finally { await file.close(); }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!frontmatter || (frontmatter[1].match(/^model:[^\r\n]*/gm) ?? []).length !== 1) {
      throw new Error(`Expected exactly one frontmatter model in ${path}`);
    }
    const model = policy.tasks[policy.defaults[role]];
    const updated = frontmatter[0].replace(/^model:[^\r\n]*/m, `model: ${model}`) + text.slice(frontmatter[0].length);
    if (text !== updated) changes.push({ path, updated, stat });
  }
  if (check) {
    if (changes.length) throw new Error(`Agent model drift; run node scripts/sync_models.mjs\n${changes.map(change => change.path).join('\n')}`);
    console.log('Agent models match pstack-models.json');
    return;
  }
  for (const { path, updated, stat } of changes) {
    const file = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      const current = await file.stat();
      if (current.dev !== stat.dev || current.ino !== stat.ino) throw new Error(`Agent changed during synchronization: ${path}`);
      if (current.nlink !== 1) throw new Error(`Refusing a hardlinked agent: ${path}`);
      await file.writeFile(updated);
      await file.truncate(Buffer.byteLength(updated));
    } finally { await file.close(); }
    console.log(`Synchronized ${path}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
