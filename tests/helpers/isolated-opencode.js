import { spawn } from 'node:child_process';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function isolatedOpenCode(root, owner = {}, {
  executable = 'opencode', startupTimeout = 30000, requestTimeout = 30000, shutdownTimeout = 5000, registerService = false,
} = {}) {
  if (process.platform === 'win32') throw new Error('Isolated server requires POSIX process groups');
  root = await realpath(root);
  if (!isAbsolute(executable)) {
    for (const directory of (process.env.PATH ?? '').split(':').filter(isAbsolute)) {
      const candidate = join(directory, executable);
      try { await access(candidate, constants.X_OK); executable = await realpath(candidate); break; }
      catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code)) throw error; }
    }
    if (!isAbsolute(executable)) throw new Error('OpenCode executable not found');
  }
  const home = join(root, 'home');
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8',
    XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
    XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
    TMPDIR: join(root, 'tmp') };
  // Refuse reused state, including symlinks into an existing installation.
  for (const directory of Object.values(env).filter(value => value.startsWith(root + '/'))) await mkdir(directory, { mode: 0o700 });
  await mkdir(join(env.XDG_CONFIG_HOME, 'opencode'));
  const config = JSON.parse(await readFile(new URL('../../opencode.json', import.meta.url), 'utf8'));
  for (const server of Object.values(config.mcp.servers)) server.disabled = true;
  await writeFile(join(env.XDG_CONFIG_HOME, 'opencode/opencode.json'), JSON.stringify({ update: 'disable', mcp: config.mcp }));
  const child = spawn(executable, ['serve', '--hostname', '127.0.0.1', '--port', '0'],
    { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  const lifetime = new AbortController();
  const pending = new Set();
  let output = '';
  let truncated = false;
  let spawnError;
  let stopping;
  let endpoint;
  let password;
  child.on('error', error => { spawnError = error; });
  const capture = data => {
    output += data;
    endpoint ??= output.match(/http:\/\/127\.0\.0\.1:\d+(?=\s)/)?.[0];
    password ??= output.match(/server password (\S+)(?=\r?\n)/)?.[1];
    if (password) output = output.replaceAll(password, '[redacted]');
    if (output.length > 256 * 1024) { output = output.slice(-256 * 1024); truncated = true; }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const signalGroup = signal => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stop = () => {
    stopping ??= (async () => {
      lifetime.abort(new Error('Isolated server stopped'));
      const timer = new AbortController();
      try {
        signalGroup('SIGTERM');
        await Promise.race([closed, delay(shutdownTimeout, undefined, { signal: timer.signal })]);
        // The leader can exit while a descendant still owns a socket or pipe.
        signalGroup('SIGKILL');
        await Promise.race([closed, delay(shutdownTimeout, undefined, { signal: timer.signal })
          .then(() => { throw new Error('Owned server did not close'); })]);
        await Promise.allSettled([...pending]);
      } finally {
        timer.abort();
        await writeFile(join(root, 'server.log'), (truncated ? '[earlier output truncated]\n' : '') +
          output.replace(/server password \S+/g, 'server password [redacted]'));
      }
    })();
    return stopping;
  };
  child.once('exit', () => { stop().catch(() => {}); });
  try {
    owner.after?.(stop);
    const deadline = Date.now() + startupTimeout;
    while (Date.now() < deadline) {
      owner.signal?.throwIfAborted();
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Isolated server exited before readiness; see redacted server.log');
      if (endpoint && password) break;
      await delay(100);
    }
    if (!endpoint || !password) throw new Error('Isolated server did not announce its endpoint and temporary password');
    const request = (method, path, body, signal) => {
      const operation = (async () => {
        if (stopping || child.exitCode !== null || child.signalCode !== null) throw new Error('Owned server is not running');
        if (!path.startsWith('/api/') || new URL(path, endpoint).origin !== endpoint) throw new Error('Request must target the owned server API');
        const response = await fetch(endpoint + path, { method: method.toUpperCase(), redirect: 'error',
          headers: { 'Content-Type': 'application/json',
            authorization: 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64') },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(requestTimeout), owner.signal, signal].filter(Boolean)) });
        const text = await response.text();
        if (!response.ok) throw Object.assign(new Error(`${method} ${path}: HTTP ${response.status}`), { status: response.status, body: text });
        return text.trim() ? JSON.parse(text) : null;
      })();
      pending.add(operation);
      operation.finally(() => pending.delete(operation)).catch(() => {});
      return operation;
    };
    const info = await request('GET', '/api/info');
    if (info.pid !== child.pid) throw new Error('Isolated server PID mismatch');
    let registrationFile;
    if (registerService) {
      registrationFile = join(root, 'test-service.json');
      await writeFile(registrationFile, JSON.stringify({ url: endpoint, pid: child.pid, version: info.version, password }), { flag: 'wx', mode: 0o600 });
    }
    const credentials = await request('GET', '/api/credential');
    if (!Array.isArray(credentials.data) || credentials.data.length) throw new Error('Isolated server inherited credentials');
    const verifyLocation = async directory => {
      const query = '?' + new URLSearchParams({ 'location[directory]': directory });
      const sources = await request('GET', '/api/config' + query);
      if (!sources.length || !sources.every(source => typeof source.path === 'string' && source.path.startsWith(root + '/'))) {
        throw new Error('Fixture configuration is absent or outside the owned root');
      }
      const mcp = await request('GET', '/api/mcp' + query);
      if (mcp.location.directory !== directory || !mcp.data.every(server => server.status.status === 'disabled')) {
        throw new Error('Fixture has an MCP that is not disabled');
      }
    };
    return { api: request, stop, endpoint, pid: child.pid, env, verifyLocation, registrationFile };
  } catch (error) {
    try { await stop(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Isolated startup and cleanup failed'); }
    throw error;
  }
}
