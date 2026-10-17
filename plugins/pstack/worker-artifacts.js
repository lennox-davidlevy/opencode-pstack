import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { inspectContainer } from './containers.js';

const limits = Object.freeze({ paths: 10000, fileBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, metadataBytes: 64 * 1024 * 1024, processMs: 10000, captureMs: 60000 });
const oidPattern = /^[a-f0-9]{40}$/;
/** @param {Buffer | string} bytes */
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** @typedef {{mode:string, oid:string}} GitEntry */
/** @typedef {{type:string, mode:string, sha256:string, bytes:number}} Content */

/** @param {string} path */
function safePath(path) {
  if (!path || path.length > 4096 || /[\x00-\x1f\x7f\\]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new Error('Unsupported artifact path');
  }
  return path;
}

/** @param {Buffer} bytes */
function text(bytes) {
  const value = bytes.toString('utf8');
  if (!Buffer.from(value).equals(bytes)) throw new Error('Unsupported non-UTF-8 metadata or path');
  return value;
}

/** A read-only, bounded repository observation. No Git diff drivers or worker config extensions are admitted.
 * @param {string} directory @param {string} baseSHA @param {AbortSignal} [signal]
 */
export async function captureRepository(directory, baseSHA, signal) {
  if (!oidPattern.test(baseSHA)) throw new Error('Unsupported base SHA');
  const root = resolve(directory);
  if (await realpath(root) !== root) throw new Error('Repository path indirection is unsupported');
  const gitdir = join(root, '.git');
  if (!(await lstat(gitdir)).isDirectory() || await realpath(gitdir) !== gitdir) throw new Error('Standalone .git directory required');
  const deadline = Date.now() + limits.captureMs;
  let paths = 0;
  let bytesRead = 0;
  let metadataBytes = 0;
  function budget() {
    signal?.throwIfAborted();
    if (Date.now() > deadline) throw new Error('Artifact capture time limit exceeded');
  }
  /** @param {string} path */
  async function read(path) {
    budget();
    if (await realpath(join(path, '..')) !== join(path, '..')) throw new Error('Artifact parent path indirection');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unsupported artifact file type or hard link');
      if (stat.size > limits.fileBytes || bytesRead + stat.size > limits.totalBytes) throw new Error('Artifact byte limit exceeded');
      const data = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < data.length) {
        budget();
        const result = await handle.read(data, length, data.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      const after = await handle.stat();
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Artifact changed during read');
      bytesRead += length;
      return data.subarray(0, length);
    } finally { await handle.close(); }
  }
  /** @type {Map<string, import('node:fs').Stats>} */
  const files = new Map();
  /** @param {string} folder @param {boolean} metadata */
  async function walk(folder, metadata) {
    budget();
    for await (const entry of await opendir(folder, { encoding: 'hex' })) {
      const name = text(Buffer.from(entry.name, 'hex'));
      if (folder === root && name === '.git') continue;
      safePath(name);
      if (++paths > limits.paths) throw new Error('Artifact path count limit exceeded');
      const path = join(folder, name);
      const stat = await lstat(path);
      if (stat.isDirectory()) await walk(path, metadata);
      else if (stat.isFile() && stat.nlink === 1 || !metadata && stat.isSymbolicLink()) {
        if (!metadata) files.set(relative(root, path), stat);
        else {
          metadataBytes += stat.size;
          if (metadataBytes > limits.metadataBytes || (name === 'index' || name.startsWith('sharedindex.')) && stat.size > limits.fileBytes) throw new Error('Artifact metadata byte limit exceeded');
          const rel = relative(gitdir, path);
          if (['commondir', 'gitdir', 'info/grafts', 'objects/info/http-alternates'].includes(rel)) throw new Error('Unsupported Git indirection');
          if (name === 'alternates') {
            for (const alternate of text(await read(path)).trim().split('\n').filter(Boolean)) {
              const target = resolve(folder, '..', alternate);
              const inside = relative(gitdir, target);
              if (inside.startsWith('..') || isAbsolute(inside) || await realpath(target) !== target) throw new Error('Git alternate escapes repository metadata');
            }
          }
          if (rel === 'HEAD' || rel.startsWith('refs/')) {
            const value = text(await read(path)).trim();
            if (value.startsWith('ref: ') && (!value.slice(5).startsWith('refs/') || !safePath(value.slice(5)))) throw new Error('Unsupported Git symbolic ref');
          }
        }
      } else throw new Error('Unsupported artifact file type, hard link, or Git metadata symlink');
    }
  }
  await walk(gitdir, true);
  // Reject configuration outside the standalone clone format rather than interpreting includes or executable helpers.
  let section = '';
  for (const raw of text(await read(join(gitdir, 'config'))).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (/^\[(core|remote "origin"|branch "[a-zA-Z0-9._/-]+")\]$/.test(line)) { section = line; continue; }
    const core = section === '[core]' && /^(repositoryformatversion\s*=\s*0|bare\s*=\s*false|(?:filemode|logallrefupdates|ignorecase|precomposeunicode)\s*=\s*(?:true|false))$/i.test(line);
    const remote = section === '[remote "origin"]' && /^(url|fetch)\s*=\s*[^\x00-\x1f"\\]+$/.test(line);
    const branch = section.startsWith('[branch ') && /^(remote|merge)\s*=\s*[a-zA-Z0-9._/*:+-]+$/.test(line);
    if (!core && !remote && !branch) throw new Error('Unsupported worker Git configuration');
  }
  await walk(root, false);
  /** @param {string[]} args @param {string} [input] */
  async function git(args, input) {
    budget();
    return new Promise((resolveOutput, reject) => {
      const child = execFile('git', ['--no-pager', '--no-optional-locks', '--git-dir=' + gitdir, '--work-tree=' + root,
        '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.excludesFile=/dev/null',
        '-c', 'diff.external=', '-c', 'diff.renames=false', '-c', 'log.showSignature=false',
        '-c', 'protocol.allow=never', ...args], {
        cwd: root, encoding: 'buffer', timeout: Math.min(limits.processMs, Math.max(1, deadline - Date.now())),
        maxBuffer: limits.totalBytes, signal,
        env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', HOME: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
          GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
          GIT_ATTR_NOSYSTEM: '1', GIT_LITERAL_PATHSPECS: '1' },
      }, (error, stdout) => error ? reject(new Error('Artifact Git read failed or exceeded limits')) : resolveOutput(stdout));
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    });
  }
  const head = text(await git(['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  if (!oidPattern.test(head)) throw new Error('Unsupported observed HEAD');
  if (text(await git(['rev-parse', '--verify', baseSHA + '^{commit}'])).trim() !== baseSHA) throw new Error('Base commit mismatch');
  // cat-file and ls-tree trust object filenames. Verify the graph, including packed/alternate objects and index roots, first.
  await git(['fsck', '--full', '--cache', '--no-reflogs', '--no-dangling', '--no-progress', baseSHA, head]);
  /** @param {Buffer} output @param {boolean} index */
  function entries(output, index) {
    /** @type {Map<string, GitEntry>} */
    const result = new Map();
    for (const row of text(output).split('\0').filter(Boolean)) {
      const split = row.indexOf('\t');
      const path = safePath(row.slice(split + 1));
      const fields = row.slice(0, split).split(' ');
      const [mode, oid] = index ? fields : [fields[0], fields[2]];
      if (split < 0 || !['100644', '100755', '120000'].includes(mode) || !oidPattern.test(oid)
        || index && fields[2] !== '0' || !index && fields[1] !== 'blob') throw new Error('Unsupported Git entry (submodule, sparse entry, or conflict)');
      result.set(path, { mode, oid });
      if (result.size > limits.paths) throw new Error('Artifact entry count limit exceeded');
    }
    return result;
  }
  const base = entries(await git(['ls-tree', '-rz', '--full-tree', baseSHA]), false);
  const committed = entries(await git(['ls-tree', '-rz', '--full-tree', head]), false);
  const index = entries(await git(['ls-files', '--stage', '-z']), true);
  const untracked = text(await git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).map(safePath).sort();
  const ignored = text(await git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])).split('\0').filter(Boolean).map(safePath).sort();
  const objects = [...new Set([...base.values(), ...committed.values(), ...index.values()].map(entry => entry.oid))].sort();
  /** @type {Map<string, {sha256:string, bytes:number}>} */
  const blobs = new Map();
  if (objects.length) {
    const output = await git(['cat-file', '--batch'], objects.join('\n') + '\n');
    let offset = 0;
    for (const oid of objects) {
      const end = output.indexOf(10, offset);
      const header = text(output.subarray(offset, end)).split(' ');
      const size = Number(header[2]);
      if (end < 0 || header[0] !== oid || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes
        || bytesRead + size > limits.totalBytes || end + size + 1 >= output.length) throw new Error('Artifact object type or byte limit exceeded');
      const content = output.subarray(end + 1, end + 1 + size);
      const actualOID = createHash('sha1').update(`blob ${size}\0`).update(content).digest('hex');
      if (actualOID !== oid || output[end + size + 1] !== 10) throw new Error('Artifact Git object integrity mismatch');
      blobs.set(oid, { sha256: digest(content), bytes: size });
      bytesRead += size;
      offset = end + size + 2;
    }
    if (offset !== output.length) throw new Error('Unexpected Git object output');
  }
  /** @param {GitEntry | undefined} entry @returns {Content | null} */
  function content(entry) {
    return entry ? { type: entry.mode === '120000' ? 'symlink' : 'file', mode: entry.mode, .../** @type {{sha256:string,bytes:number}} */ (blobs.get(entry.oid)) } : null;
  }
  const candidates = [...new Set([...base.keys(), ...committed.keys(), ...index.keys(), ...untracked])].sort();
  if (candidates.length > limits.paths) throw new Error('Artifact entry count limit exceeded');
  const changes = [];
  const staged = [];
  const indexDifferences = [];
  const indexOnlyBlobs = [];
  for (const path of candidates) {
    budget();
    const stat = files.get(path);
    /** @type {Content | null} */
    let current = null;
    if (stat) {
      const absolute = join(root, path);
      if (await realpath(join(absolute, '..')) !== join(absolute, '..')) throw new Error('Artifact parent path indirection');
      const data = stat.isSymbolicLink() ? await readlink(absolute, { encoding: 'buffer' }) : await read(absolute);
      if (stat.isSymbolicLink()) bytesRead += data.length;
      if (data.length > limits.fileBytes || bytesRead > limits.totalBytes) throw new Error('Artifact byte limit exceeded');
      current = { type: stat.isSymbolicLink() ? 'symlink' : 'file', mode: stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644', sha256: digest(data), bytes: data.length };
    }
    const before = content(base.get(path));
    const indexed = content(index.get(path));
    if (JSON.stringify(before) !== JSON.stringify(current)) {
      changes.push({ path, status: !before ? 'added' : !current ? 'deleted' : 'modified', tracked: base.has(path) || committed.has(path) || index.has(path), before, after: current });
    }
    const indexOnly = indexed !== null && JSON.stringify(indexed) !== JSON.stringify(current);
    if (indexOnly) indexOnlyBlobs.push(path);
    if (JSON.stringify(indexed) !== JSON.stringify(current) && (index.has(path) || committed.has(path))) {
      indexDifferences.push({ path, index: indexed, workingTree: current });
    }
    if (JSON.stringify(content(committed.get(path))) !== JSON.stringify(indexed)) {
      staged.push({ path, head: content(committed.get(path)), index: indexed, indexOnly });
    }
  }
  budget();
  return { baseSHA, head, entries: changes, staged, indexDifferences, excluded: { ignored, untracked: [], indexOnlyBlobs },
    policy: { contents: 'metadata only; no file or Git blob contents', untracked: 'include nonignored', ignored: 'exclude', indexOnlyBlobs: 'metadata only', symlinks: 'hash link bytes without following', renames: 'delete and add' } };
}

/** @param {import('./worker-history.js').WorkerHistory} workers @param {string} owner @param {string} id @param {AbortSignal} [signal] */
export async function workerManifest(workers, owner, id, signal) {
  const worker = await workers.get(owner, id);
  if (worker.backend !== 'container') throw new Error('Artifact manifests do not support local workers');
  if (typeof worker.sessionID !== 'string' || !/^ses_[a-zA-Z0-9]+$/.test(worker.sessionID)) throw new Error('Invalid worker session ID');
  if (!['docker', 'podman'].includes(worker.engine) || worker.container !== `pstack-${worker.id}`) throw new Error('Invalid worker container identity');
  /** @param {Awaited<ReturnType<typeof inspectContainer>>} state */
  function stopped(state) {
    if (!['exited', 'dead'].includes(state.state) || state.running || state.paused || state.restarting) throw new Error('Artifact manifest requires a stopped container; no automatic stop is performed');
    return state;
  }
  const before = stopped(await inspectContainer(worker));
  const first = await captureRepository(worker.directory, worker.ref, signal);
  const middle = stopped(await inspectContainer(worker));
  const second = await captureRepository(worker.directory, worker.ref, signal);
  const after = stopped(await inspectContainer(worker));
  if (JSON.stringify(before) !== JSON.stringify(middle) || JSON.stringify(before) !== JSON.stringify(after)
    || JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Worker artifacts changed during observation');
  const observation = { version: 1, worker: { id: worker.id, owner: worker.owner, sessionID: worker.sessionID,
    directory: worker.directory, role: worker.role ?? null, backend: worker.backend, ref: worker.ref }, ...second };
  return { ...observation, artifactDigest: digest(JSON.stringify(observation)), observedAt: new Date().toISOString(),
    container: after, limits, consistency: 'Two matching passes with stopped-container checks. Not immutable against host writers.' };
}
