import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function isolatedOpenCode(root) {
  const home = join(root, 'home');
  const env = { PATH: process.env.PATH, HOME: home, LANG: 'C.UTF-8',
    XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
    XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
    TMPDIR: join(root, 'tmp') };
  for (const directory of Object.values(env).filter(value => value?.startsWith(root))) await mkdir(directory, { recursive: true });
  await mkdir(join(env.XDG_CONFIG_HOME, 'opencode'), { recursive: true });
  await writeFile(join(env.XDG_CONFIG_HOME, 'opencode/opencode.json'), JSON.stringify({ update: 'disable' }));
  const child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit').catch(() => {});
  let output = '';
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, delay(5000)]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    }
    await writeFile(join(root, 'server.log'), output.replace(/server password \S+/g, 'server password [redacted]'));
  };
  try {
    let endpoint;
    let password;
    for (let attempt = 0; attempt < 300; attempt++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Isolated server exited before readiness; see redacted server.log');
      endpoint = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      password = output.match(/server password (\S+)/)?.[1];
      if (endpoint && password) break;
      await delay(100);
    }
    if (!endpoint || !password) throw new Error('Isolated server did not announce its endpoint and temporary password');
    const api = async (method, path, body) => {
      const response = await fetch(endpoint + path, { method, headers: { 'Content-Type': 'application/json',
        authorization: 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64') },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
      return response.json();
    };
    return { api, stop, endpoint, pid: child.pid, env };
  } catch (error) { await stop(); throw error; }
}
