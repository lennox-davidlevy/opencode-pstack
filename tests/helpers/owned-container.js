import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import { startContainer } from '../../plugins/pstack/containers.js';

const exec = promisify(execFile);
const commandOptions = { timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 };

async function findContainer(worker) {
  const { stdout } = await exec(worker.engine, ['container', 'ls', '--all', '--no-trunc',
    '--filter', `name=^/?${worker.container}$`, '--format', '{{.ID}}'], commandOptions);
  const ids = stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length === 0) return null;
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0])) throw new Error(`Unexpected container identity for ${worker.container}`);
  const result = await exec(worker.engine, ['container', 'inspect', ids[0]], commandOptions);
  const [info] = JSON.parse(result.stdout);
  if (info?.Id !== ids[0] || ![worker.container, `/${worker.container}`].includes(info.Name)
    || info.Config?.Labels?.['pstack.owner'] !== worker.owner
    || info.Config?.Labels?.['pstack.worker'] !== worker.id) {
    throw new Error(`Container ownership mismatch during cleanup of ${worker.container}`);
  }
  return info.Id;
}

export function ownedContainers(t) {
  const workers = [];
  const directories = [];
  const starts = new Set();
  let closing = false;
  t.after(async () => {
    closing = true;
    await Promise.allSettled([...starts]);
    const errors = [];
    for (const worker of workers) {
      try {
        const id = await findContainer(worker);
        if (id) {
          await exec(worker.engine, ['container', 'rm', '--force', id], commandOptions);
          if (await findContainer(worker)) throw new Error(`Container remains after cleanup: ${worker.container}`);
        }
      } catch (error) { errors.push(error); }
    }
    // Keep mounted fixtures intact when container cleanup cannot be confirmed.
    if (errors.length) throw new AggregateError(errors, 'Owned container cleanup failed');
    for (const directory of directories) {
      try { await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Owned fixture cleanup failed');
  });
  return {
    directory(path) {
      if (closing) throw new Error('Owned container fixtures are closing');
      directories.push(path);
      return path;
    },
    async start(options, base) {
      if (closing) throw new Error('Owned containers are closing');
      if (!['docker', 'podman'].includes(options.engine) || !/^[a-f0-9-]{36}$/.test(base.id)
        || typeof base.owner !== 'string' || !base.owner) throw new Error('Invalid test container identity');
      const worker = { ...base, engine: options.engine, container: `pstack-${base.id}` };
      // The daemon can create the container even when the startup command fails.
      workers.push(worker);
      const operation = startContainer(options, base);
      starts.add(operation);
      try { return { ...worker, ...await operation }; }
      finally { starts.delete(operation); }
    },
  };
}
