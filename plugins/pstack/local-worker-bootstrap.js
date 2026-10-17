import { mkdir, readFile, copyFile, writeFile, constants } from 'node:fs/promises';
import { join } from 'node:path';

const workerRoles = ['poteto', 'poteto-agent', 'poteto-reviewer', 'poteto-investigator'];

/** Install the authoritative Markdown roles without overwriting checkout configuration.
 * @param {string} assets @param {string} checkout @param {any[]} restrictions
 */
export async function bootstrapLocalWorker(assets, checkout, restrictions) {
  const config = JSON.parse(await readFile(join(assets, 'opencode.json'), 'utf8'));
  config.skills = [join(assets, 'skills')];
  config.plugins = [join(assets, 'plugins/pstack')];
  for (const role of workerRoles) {
    config.agents[role] = { permissions: [
      { action: 'external_directory', resource: join(assets, 'skills') + '/**', effect: 'allow' },
      ...restrictions,
    ] };
  }
  const directory = join(checkout, '.opencode');
  // An existing directory or symlink belongs to the checkout, not this bootstrap.
  await mkdir(directory);
  await mkdir(join(directory, 'agents'));
  for (const role of workerRoles) {
    await copyFile(join(assets, 'agents', role + '.md'), join(directory, 'agents', role + '.md'), constants.COPYFILE_EXCL);
  }
  await writeFile(join(directory, 'opencode.json'), JSON.stringify(config, null, 2), { flag: 'wx' });
}
