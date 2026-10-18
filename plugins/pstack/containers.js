import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** @param {any} options @param {AbortSignal} [signal] */
export async function containerOptions(options, signal) {
  const engine = options?.engine ?? 'docker';
  const image = options?.image ?? 'opencode-pstack-worker:0.1.0';
  if (!['docker', 'podman'].includes(engine) || typeof image !== 'string' || !image || image.startsWith('-')) throw new Error('Invalid container engine/image');
  await exec(engine, ['image', 'inspect', image], { signal, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  return { engine, image };
}

/** Returns the existing engine/name fields plus containerID for later identity checks.
 * @param {{engine:string,image:string}} options @param {any} worker @param {AbortSignal} [signal]
 */
export async function startContainer(options, worker, signal) {
  if (worker.directory.includes(',')) throw new Error('Container mount paths cannot contain commas');
  const name = `pstack-${worker.id}`;
  const { stdout } = await exec(options.engine, ['run', '--detach', '--init', '--name', name,
    '--label', `pstack.owner=${worker.owner}`, '--label', `pstack.worker=${worker.id}`,
    '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--pids-limit=256', '--memory=4g', '--cpus=2',
    '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=1g',
    '--mount', `type=bind,src=${worker.directory},dst=/workspace${worker.role === 'poteto-agent' ? '' : ',readonly'}`,
    '--entrypoint', '/bin/sleep', options.image, 'infinity'], { signal, timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  const containerID = stdout.trim();
  if (!containerID || !/^[a-f0-9]{64}$/.test(containerID)) throw new Error('Invalid container identity from startup');
  const result = { engine: options.engine, container: name, containerID };
  await owned({ ...worker, ...result }, signal);
  return result;
}

/** @param {any} worker @param {AbortSignal} [signal] */
async function owned(worker, signal) {
  const expectedID = worker.containerID;
  if (expectedID !== undefined && (typeof expectedID !== 'string' || !/^[a-f0-9]{64}$/.test(expectedID))) throw new Error('Invalid container identity');
  if (typeof worker.owner !== 'string' || !worker.owner || typeof worker.id !== 'string' || !worker.id) throw new Error('Container ownership mismatch');
  const { stdout } = await exec(worker.engine, ['inspect', expectedID ?? worker.container],
    { signal, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  const entries = JSON.parse(stdout);
  const info = Array.isArray(entries) && entries.length === 1 ? entries[0] : undefined;
  if (!info || typeof info.Id !== 'string' || !/^[a-f0-9]{64}$/.test(info.Id)
    || typeof info.State?.Running !== 'boolean') throw new Error('Invalid container inspection');
  if (info.Config?.Labels?.['pstack.owner'] !== worker.owner || info.Config?.Labels?.['pstack.worker'] !== worker.id) throw new Error('Container ownership mismatch');
  if (expectedID !== undefined && info.Id !== expectedID) throw new Error('Container identity mismatch');
  return info;
}

/** @param {any} worker @param {boolean} [stop] @param {AbortSignal} [signal] */
export async function inspectContainer(worker, stop = false, signal) {
  const before = await owned(worker, signal);
  if (stop) await exec(worker.engine, ['stop', '--time', '2', before.Id],
    { signal, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  const info = await owned({ ...worker, containerID: before.Id }, signal);
  if (stop && info.State.Running) throw new Error('Container stop could not be confirmed');
  return { container: worker.container, state: info.State.Status, exitCode: info.State.ExitCode,
    containerID: info.Id, running: info.State.Running, paused: info.State.Paused,
    restarting: info.State.Restarting, startedAt: info.State.StartedAt,
    finishedAt: info.State.FinishedAt, restartCount: info.RestartCount };
}

/** Execute only inside an owned sandbox; never pass credentials or host paths.
 * @param {any} worker @param {string} command @param {AbortSignal} [signal]
 */
export async function containerCommand(worker, command, signal) {
  const info = await owned(worker, signal);
  if (!info.State.Running) throw new Error('Worker container is stopped');
  try {
    const result = await exec(worker.engine, ['exec', '--workdir', '/workspace', info.Id,
      '/usr/bin/timeout', '--signal=TERM', '--kill-after=2', '60', '/bin/sh', '-c', command],
    { signal, timeout: 65_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    return { ...result, exitCode: 0 };
  } catch (error) {
    const failure = /** @type {any} */ (error);
    // Killing the Docker CLI does not stop the process inside the container.
    if (signal?.aborted || failure.killed || failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      try {
        await inspectContainer({ ...worker, containerID: info.Id }, true, AbortSignal.timeout(65_000));
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Container command failed and cleanup failed', { cause: error });
      }
      throw error;
    }
    if (typeof failure.code === 'number') return { stdout: failure.stdout, stderr: failure.stderr, exitCode: failure.code };
    throw error;
  }
}
