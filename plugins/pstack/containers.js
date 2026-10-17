import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** @param {any} options */
export async function containerOptions(options) {
  const engine = options?.engine ?? 'docker';
  const image = options?.image ?? 'opencode-pstack-worker:0.1.0';
  if (!['docker', 'podman'].includes(engine) || typeof image !== 'string' || !image || image.startsWith('-')) throw new Error('Invalid container engine/image');
  await exec(engine, ['image', 'inspect', image], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  return { engine, image };
}

/** @param {{engine:string,image:string}} options @param {any} worker */
export async function startContainer(options, worker) {
  if (worker.directory.includes(',')) throw new Error('Container mount paths cannot contain commas');
  const name = `pstack-${worker.id}`;
  await exec(options.engine, ['run', '--detach', '--init', '--name', name,
    '--label', `pstack.owner=${worker.owner}`, '--label', `pstack.worker=${worker.id}`,
    '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--pids-limit=256', '--memory=4g', '--cpus=2',
    '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=1g',
    '--mount', `type=bind,src=${worker.directory},dst=/workspace${worker.role === 'poteto-agent' ? '' : ',readonly'}`,
    '--entrypoint', '/bin/sleep', options.image, 'infinity'], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  return { engine: options.engine, container: name };
}

/** @param {any} worker */
async function owned(worker) {
  const { stdout } = await exec(worker.engine, ['inspect', worker.container], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const info = JSON.parse(stdout)[0];
  if (info.Config.Labels?.['pstack.owner'] !== worker.owner || info.Config.Labels?.['pstack.worker'] !== worker.id) throw new Error('Container ownership mismatch');
  return info;
}

/** @param {any} worker @param {boolean} [stop] */
export async function inspectContainer(worker, stop = false) {
  await owned(worker);
  if (stop) await exec(worker.engine, ['stop', '--time', '2', worker.container], { timeout: 30_000 });
  const info = await owned(worker);
  return { container: worker.container, state: info.State.Status, exitCode: info.State.ExitCode,
    containerID: info.Id, running: info.State.Running, paused: info.State.Paused,
    restarting: info.State.Restarting, startedAt: info.State.StartedAt,
    finishedAt: info.State.FinishedAt, restartCount: info.RestartCount };
}

/** Execute only inside an owned sandbox; never pass credentials or host paths.
 * @param {any} worker @param {string} command @param {AbortSignal} [signal]
 */
export async function containerCommand(worker, command, signal) {
  const info = await owned(worker);
  if (!info.State.Running) throw new Error('Worker container is stopped');
  try {
    const result = await exec(worker.engine, ['exec', '--workdir', '/workspace', worker.container,
      '/usr/bin/timeout', '--signal=TERM', '--kill-after=2', '60', '/bin/sh', '-c', command],
    { signal, timeout: 65_000, maxBuffer: 1024 * 1024 });
    return { ...result, exitCode: 0 };
  } catch (error) {
    const failure = /** @type {any} */ (error);
    // Killing the Docker CLI does not stop the process inside the container.
    if (signal?.aborted || failure.killed || failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      await inspectContainer(worker, true);
      throw error;
    }
    if (typeof failure.code === 'number') return { stdout: failure.stdout, stderr: failure.stderr, exitCode: failure.code };
    throw error;
  }
}
