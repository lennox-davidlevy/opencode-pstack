import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';

const exec = promisify(execFile);

/** Authenticated CLI transport; never constructs its own server credentials.
 * @param {string} method @param {string} path @param {unknown} [body]
 * @param {AbortSignal} [signal] @returns {Promise<any>}
 */
export async function api(method, path, body, signal) {
  const args = ['api', method, path];
  if (body !== undefined) args.push('--data', JSON.stringify(body));
  const { stdout } = await exec('opencode', args, {
    signal, timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

/** @param {string} directory @param {string} sessionID @param {typeof api} request */
export async function scopedSession(directory, sessionID, request = api) {
  if (!/^ses_[a-zA-Z0-9]+$/.test(sessionID)) throw new Error('Invalid session ID');
  const { data } = await request('get', `/api/session/${sessionID}`);
  if (!data.location?.directory || await realpath(data.location.directory) !== await realpath(directory)) {
    throw new Error('Session is outside this working directory');
  }
  return data;
}

/** @param {string} directory @param {number} limit @param {string|undefined} cursor
 * @param {typeof api} request
 */
export async function historyList(directory, limit, cursor, request = api) {
  const query = new URLSearchParams({ directory, limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  const page = await request('get', `/api/session?${query}`);
  const canonical = await realpath(directory);
  for (const session of page.data) {
    if (!session.location?.directory || await realpath(session.location.directory) !== canonical) {
      throw new Error('History cursor belongs to another directory');
    }
  }
  return { ...page, data: page.data.map((/** @type {any} */ s) => ({
    id: s.id, title: s.title, parentID: s.parentID, time: s.time, agent: s.agent,
  })) };
}
