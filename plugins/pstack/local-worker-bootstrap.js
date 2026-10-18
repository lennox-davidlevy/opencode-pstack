import { mkdir, readFile, copyFile, writeFile, constants } from 'node:fs/promises';
import { join } from 'node:path';

const workerRoles = ['poteto', 'poteto-agent', 'poteto-reviewer', 'poteto-investigator'];

/** Install the authoritative Markdown roles without overwriting checkout configuration.
 * @param {string} assets @param {string} checkout @param {any[]} restrictions
 */
export async function bootstrapLocalWorker(assets, checkout, restrictions) {
  const bundled = JSON.parse(await readFile(join(assets, 'opencode.json'), 'utf8'));
  const config = {
    $schema: bundled.$schema,
    default_agent: bundled.default_agent,
    skills: [join(assets, 'skills')],
    plugins: [],
    permissions: bundled.permissions,
    snapshots: false,
    lsp: false,
    formatter: false,
    mcp: { servers: Object.fromEntries(Object.entries(bundled.mcp?.servers ?? {})
      .map(([id, definition]) => [id, { ...definition, disabled: true }])) },
    agents: Object.fromEntries(Object.entries(bundled.agents)
      .filter(([, agent]) => agent.disabled === true)),
  };
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
