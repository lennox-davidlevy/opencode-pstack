import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../skills/pstack-poteto-mode/scripts/worktree-audit.sh', import.meta.url));
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();

function fixture() {
  const root = mkdtempSync(join(existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir(), 'worktree-audit-'));
  const repo = join(root, 'repo with spaces');
  mkdirSync(repo);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...args) => {
    const result = spawnSync(realGit, ['-C', repo, ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git('init', '--quiet');
  git('remote', 'add', 'origin', 'https://invalid.example/no-network');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const log = join(root, 'git-calls');
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['AUDIT_CALL_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
if any(arg in ('fetch', 'push', 'pull', 'clone', 'commit', 'reset', 'clean', 'remove', 'prune') for arg in args):
    sys.exit(93)
os.execv(os.environ['AUDIT_REAL_GIT'], ['git', *args])
`, { mode: 0o755 });
  const audit = (...args) => spawnSync('bash', [script, ...args, repo], {
    env: { ...env, PATH: `${bin}:${env.PATH}`, AUDIT_CALL_LOG: log, AUDIT_REAL_GIT: realGit },
    encoding: 'utf8',
  });
  return { repo, git, audit, log };
}

function snapshot(path) {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    const child = join(path, entry.name);
    return [entry.name, entry.isDirectory() ? snapshot(child) : readFileSync(child).toString('base64')];
  });
}

function rows(output) {
  const [header, ...records] = output.trimEnd().split('\n').filter(line => !line.startsWith('#'));
  return records.map(line => Object.fromEntries(header.split('\t').map((key, i) => [key, line.split('\t')[i]])));
}

test('unborn inventory preserves untracked work and Git state without fetching', () => {
  const { repo, git, audit, log } = fixture();
  writeFileSync(join(repo, 'precious\nnotes.txt'), 'keep my unpublished work\n');
  const before = snapshot(repo);
  const result = audit();
  assert.equal(result.status, 0, result.stderr);
  const [row] = rows(result.stdout);
  assert.equal(row.WORKTREE, repo);
  assert.equal(row.DIRTY, 'untracked:1');
  assert.equal(row.BUCKET, 'review-required');
  assert.equal(row.LAST_CHAT, 'unknown');
  assert.equal(row.MERGED, 'unknown');
  assert.deepEqual(snapshot(repo), before);
  assert.equal(git('rev-list', '--all'), '');
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(args => args.includes('status')), 'the command recorder sees real Git inspection');
  assert.ok(calls.every(args => !args.includes('fetch')), 'audit must not attempt fetch, even best-effort');
});

test('staged and ignored files remain review-required and unchanged', () => {
  const { repo, git, audit } = fixture();
  writeFileSync(join(repo, 'draft.txt'), 'staged but not committed');
  git('add', 'draft.txt');
  writeFileSync(join(repo, '.git', 'info', 'exclude'), 'private-cache\n');
  writeFileSync(join(repo, 'private-cache'), 'not disposable');
  const before = snapshot(repo);
  const result = audit();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(rows(result.stdout)[0].DIRTY, 'wip:1,ignored:1');
  assert.equal(rows(result.stdout)[0].BUCKET, 'review-required');
  assert.deepEqual(snapshot(repo), before);
});

test('clean unknown activity requires review; missing explicit remote base never fetches', () => {
  const { repo, audit, log } = fixture();
  const before = snapshot(repo);
  const clean = audit();
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(rows(clean.stdout)[0].DIRTY, 'clean');
  assert.equal(rows(clean.stdout)[0].BUCKET, 'review-required');
  const missing = audit('--base', 'origin/main');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /unavailable locally/);
  assert.deepEqual(snapshot(repo), before);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.every(args => !args.includes('fetch')));
});

test('linked unborn worktrees with control characters stay distinct and preserve work', () => {
  const { repo, git, audit } = fixture();
  const linked = join(repo, '..', 'linked\tworktree\n');
  git('worktree', 'add', '--orphan', '-b', 'other', linked);
  writeFileSync(join(linked, 'notes'), 'untracked work in a linked worktree');
  const before = snapshot(repo);
  const linkedBefore = snapshot(linked);
  const result = audit();
  assert.equal(result.status, 0, result.stderr);
  const inventory = rows(result.stdout);
  assert.equal(inventory.length, 2);
  assert.equal(inventory[0].WORKTREE, repo);
  assert.equal(JSON.parse(inventory[1].WORKTREE), linked);
  assert.equal(inventory[1].DIRTY, 'untracked:1');
  assert.ok(inventory.every(row => row.BUCKET === 'review-required'));
  assert.deepEqual(snapshot(repo), before);
  assert.deepEqual(snapshot(linked), linkedBefore);
  assert.equal(git('rev-list', '--all'), '');
});

test('signed history inventory does not invoke a configured signature verifier', t => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  const existing = spawnSync(realGit, ['-C', source, 'log', '--no-show-signature', '-30', '--format=%H'], { encoding: 'utf8' });
  const signed = existing.stdout.trim().split('\n').find(oid => {
    if (!/^[a-f0-9]{40,64}$/.test(oid)) return false;
    return spawnSync(realGit, ['-C', source, 'cat-file', 'commit', oid], { encoding: 'utf8' }).stdout.includes('\ngpgsig -----BEGIN PGP SIGNATURE-----');
  });
  if (!signed) { t.skip('No existing signed artifact in this checkout history; no commits created'); return; }
  const objects = spawnSync(realGit, ['-C', source, 'rev-parse', '--path-format=absolute', '--git-path', 'objects'], { encoding: 'utf8' }).stdout.trim();
  const { repo, git, audit } = fixture();
  writeFileSync(join(repo, '.git', 'objects', 'info', 'alternates'), objects + '\n');
  git('update-ref', 'HEAD', signed);
  const marker = join(repo, 'verifier-called');
  const verifier = join(repo, 'verify');
  writeFileSync(verifier, `#!/bin/sh\nprintf called >> '${marker}'\nexit 1\n`, { mode: 0o755 });
  git('config', 'gpg.program', verifier);
  git('config', 'log.showSignature', 'true');
  git('show', '-s', '--format=%ct', 'HEAD');
  const before = readFileSync(marker, 'utf8');
  assert.ok(before.length > 0, 'positive control must actually invoke the verifier');
  const result = audit();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(marker, 'utf8'), before, 'audit must not execute the external verifier');
  assert.equal(rows(result.stdout)[0].BUCKET, 'review-required');
});
