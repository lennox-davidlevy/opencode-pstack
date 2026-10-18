import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = fileURLToPath(new URL('../skills/pstack-poteto-mode/scripts/', import.meta.url));
const bunProbe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
const bun = bunProbe.status === 0
  ? spawnSync('bun', ['--no-install', '-e', 'console.log(process.execPath)'], { encoding: 'utf8' }).stdout.trim()
  : null;

function localCommander() {
  const installed = join(source, 'node_modules', 'commander');
  if (existsSync(join(installed, 'package.json'))) return installed;
  const cache = process.env.BUN_INSTALL_CACHE_DIR || join(homedir(), '.bun', 'install', 'cache');
  if (!existsSync(cache)) return null;
  const cached = readdirSync(cache).sort().find(name => /^commander@14\./.test(name) && existsSync(join(cache, name, 'package.json')));
  return cached ? join(cache, cached) : null;
}

function snapshot(path) {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) return [entry.name, 'symlink'];
    if (entry.isDirectory()) return [entry.name, snapshot(child)];
    const stat = statSync(child);
    return [entry.name, stat.mode, stat.mtimeMs, createHash('sha256').update(readFileSync(child)).digest('hex')];
  });
}

function fixture(t) {
  if (!bun) { t.skip('Bun is not installed; no downloads attempted'); return null; }
  const root = mkdtempSync(join(existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir(), 'bootstrap-'));
  let unsettled = false;
  t.after(() => {
    assert.equal(unsettled, false, `Bootstrap subprocess cleanup is uncertain; retained ${root}`);
    rmSync(root, { recursive: true, force: true });
    assert.equal(existsSync(root), false);
  });
  const scripts = join(root, 'tools with spaces');
  mkdirSync(scripts);
  for (const name of ['bootstrap.ts', 'package.json', 'bun.lock', 'orch', 'watch-pr']) {
    cpSync(join(source, name), join(scripts, name), { recursive: true });
  }
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const cache = join(root, 'cache');
  for (const directory of [bin, home, cache]) mkdirSync(directory);
  symlinkSync(bun, join(bin, 'bun'));
  const log = join(root, 'installer-calls');
  const ghLog = join(root, 'gh-calls');
  const installer = join(bin, 'fake-installer');
  writeFileSync(installer, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
const exit = Number(process.env.FIXTURE_INSTALL_EXIT || 0);
if (exit) { console.error('fixture installer failure'); process.exit(exit); }
if (process.env.FIXTURE_INSTALL_EMPTY !== '1') {
  const destination = path.join(process.cwd(), 'node_modules', 'commander');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'package.json'), '{}\\n');
}
`, { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
console.error('fixture gh unavailable');
process.exit(1);
`, { mode: 0o755 });
  const preload = join(root, 'preload.ts');
  writeFileSync(preload, `Object.defineProperty(process, 'execPath', { value: ${JSON.stringify(installer)} });\n`);
  writeFileSync(join(scripts, 'bunfig.toml'), `preload = [${JSON.stringify(preload)}]\n[install]\nregistry = "http://127.0.0.1:9"\n`);
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home, XDG_CONFIG_HOME: home, BUN_INSTALL_CACHE_DIR: cache,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
    BUN_CONFIG_HTTP_IDLE_TIMEOUT: '1', DO_NOT_TRACK: '1',
  };
  const marker = join(scripts, 'node_modules', '.poteto-mode-tools-install-key');
  function run(entry, args = [], { direct = false, flags = ['--no-install'], extraEnv = {} } = {}) {
    const command = direct ? join(scripts, entry) : bun;
    const argv = direct ? args : [...flags, join(scripts, entry), ...args];
    const result = spawnSync(command, argv, { cwd: scripts, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 10000 });
    unsettled ||= Boolean(result.error || result.signal);
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.signal, null, result.stderr);
    return result;
  }
  function setup() {
    const result = run('bootstrap.ts', ['--install'], { flags: [] });
    assert.equal(result.status, 0, result.stderr);
  }
  return { root, scripts, marker, log, ghLog, run, setup };
}

const commands = [
  ['watch-pr/watch-pr', ['--help']],
  ['watch-pr/watch-pr', ['--status-only', '--owner', 'fixture', '--repo', 'fixture', '--pr', '1']],
  ['orch/orch.ts', ['--help']],
  ['orch/orch.ts', ['--store', 'store', 'status']],
  ['bootstrap.ts', []],
];

for (const state of ['missing', 'missing-marker', 'missing-commander', 'changed-manifest', 'changed-lockfile', 'missing-lockfile']) {
  test(`${state} dependencies fail before help or status without installation or other effects`, t => {
    const f = fixture(t);
    if (!f) return;
    if (state !== 'missing') f.setup();
    if (state === 'missing-marker') rmSync(f.marker);
    if (state === 'missing-commander') rmSync(join(f.scripts, 'node_modules', 'commander'), { recursive: true });
    if (state === 'changed-manifest') writeFileSync(join(f.scripts, 'package.json'), readFileSync(join(f.scripts, 'package.json'), 'utf8') + '\n');
    if (state === 'changed-lockfile') writeFileSync(join(f.scripts, 'bun.lock'), readFileSync(join(f.scripts, 'bun.lock'), 'utf8') + '\n');
    if (state === 'missing-lockfile') rmSync(join(f.scripts, 'bun.lock'));
    const before = snapshot(f.root);
    for (const [entry, args] of commands) {
      // Also exercise callers that omit --no-install. The guard must run first.
      for (const flags of [[], ['--no-install']]) {
        const result = f.run(entry, args, { flags });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /dependencies.*missing or stale/i);
        assert.match(result.stderr, /bootstrap\.ts.*--install/);
        assert.equal(result.stdout, '');
        assert.deepEqual(snapshot(f.root), before);
      }
    }
    assert.equal(existsSync(f.ghLog), false);
  });
}

test('explicit setup installs once with a frozen lockfile, records success, and never replays a command', t => {
  const f = fixture(t);
  if (!f) return;
  const manifest = readFileSync(join(f.scripts, 'package.json'));
  const lock = readFileSync(join(f.scripts, 'bun.lock'));
  f.setup();
  assert.deepEqual(readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse), [
    { args: ['install', '--frozen-lockfile'], cwd: f.scripts },
  ]);
  const expected = createHash('sha256').update(manifest).update('\0').update(lock).digest('hex');
  assert.equal(readFileSync(f.marker, 'utf8'), `${expected}\n`);
  assert.deepEqual(readFileSync(join(f.scripts, 'package.json')), manifest);
  assert.deepEqual(readFileSync(join(f.scripts, 'bun.lock')), lock);
  const before = snapshot(f.root);
  const ready = f.run('bootstrap.ts');
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(ready.stdout, '');
  assert.deepEqual(snapshot(f.root), before);
  const invalid = f.run('bootstrap.ts', ['--install', '--status-only']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Usage/);
  assert.deepEqual(snapshot(f.root), before);
});

for (const mode of ['failure', 'empty']) {
  test(`explicit setup with ${mode} installer does not record success`, t => {
    const f = fixture(t);
    if (!f) return;
    const result = f.run('bootstrap.ts', ['--install'], {
      extraEnv: mode === 'failure' ? { FIXTURE_INSTALL_EXIT: '42' } : { FIXTURE_INSTALL_EMPTY: '1' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, mode === 'failure' ? /fixture installer failure[\s\S]*status 42/ : /without installing commander/);
    assert.equal(existsSync(f.marker), false);
    assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 1);
    assert.equal(existsSync(f.ghLog), false);
  });
}

test('ready entrypoints show help without effects through Bun and executable shebangs', t => {
  const commander = localCommander();
  if (!commander) { t.skip('No existing Commander 14 package available; no installation attempted'); return; }
  const f = fixture(t);
  if (!f) return;
  f.setup();
  cpSync(commander, join(f.scripts, 'node_modules', 'commander'), { recursive: true });
  const before = snapshot(f.root);
  for (const [entry] of commands.filter(([entry, args]) => args[0] === '--help')) {
    for (const direct of [false, true]) {
      const result = f.run(entry, ['--help'], { direct });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage:/);
      assert.deepEqual(snapshot(f.root), before);
    }
  }
  const config = join(f.scripts, 'bunfig.toml');
  writeFileSync(config, readFileSync(config, 'utf8') + 'auto = "force"\n');
  const forcedBefore = snapshot(f.root);
  for (const entry of ['watch-pr/watch-pr', 'orch/orch.ts']) {
    for (const direct of [false, true]) {
      const result = f.run(entry, ['--help'], { direct });
      // Some Bun versions disable resolution entirely when force conflicts with no-install.
      if (result.status !== 0) assert.match(result.stderr, /Cannot find package 'commander'/);
      else assert.match(result.stdout, /Usage:/);
      assert.deepEqual(snapshot(f.root), forcedBefore);
    }
  }
});

test('ready watcher status still calls gh and ready orch status still writes its report', t => {
  const commander = localCommander();
  if (!commander) { t.skip('No existing Commander 14 package available; no installation attempted'); return; }
  const f = fixture(t);
  if (!f) return;
  f.setup();
  cpSync(commander, join(f.scripts, 'node_modules', 'commander'), { recursive: true });
  const installCalls = readFileSync(f.log, 'utf8');
  const status = f.run('watch-pr/watch-pr', [...commands[1][1], '--max-query-errors', '1', '--interval', '0.01']);
  assert.ok(existsSync(f.ghLog), status.stderr);
  assert.ok(readFileSync(f.ghLog, 'utf8').length > 0);
  const init = f.run('orch/orch.ts', ['--store', 'store', 'init']);
  assert.equal(init.status, 0, init.stderr);
  const report = join(f.scripts, 'store', 'status.md');
  writeFileSync(report, 'old report');
  const orch = f.run('orch/orch.ts', ['--store', 'store', 'status']);
  assert.equal(orch.status, 0, orch.stderr);
  assert.notEqual(readFileSync(report, 'utf8'), 'old report');
  assert.equal(readFileSync(f.log, 'utf8'), installCalls);
});
