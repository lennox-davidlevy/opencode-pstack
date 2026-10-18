import { OpenCode } from '@opencode/client';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** One registration snapshot and one authenticated endpoint for an entire operation.
 * Credentials remain in the client's closure, never in the durable identity.
 * @param {{registrationFile?:string}} [options] @param {AbortSignal} [signal] */
export async function workerTransport(options = {}, signal) {
  signal?.throwIfAborted();
  if (options.registrationFile !== undefined && !isAbsolute(options.registrationFile)) throw new Error('Absolute worker server registration file required');
  let registration;
  try {
    // @opencode/client 2.0.31 service read/fallback format, without its unguarded probe.
    const file = options.registrationFile ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'opencode', 'service.json');
    const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 65536) throw new Error();
      const bytes = Buffer.alloc(65537);
      let size = 0;
      while (size < bytes.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > 65536) throw new Error();
      registration = JSON.parse(bytes.subarray(0, size).toString('utf8'));
    } finally { await handle.close(); }
    if (typeof registration?.url !== 'string' || !Number.isSafeInteger(registration.pid) || registration.pid < 0 ||
        registration.password !== undefined && typeof registration.password !== 'string' ||
        registration.version !== undefined && typeof registration.version !== 'string') throw new Error();
  }
  catch { throw new Error('Worker server discovery failed; no service was started'); }
  signal?.throwIfAborted();
  let endpoint;
  try {
    const url = new URL(registration.url);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    endpoint = url.origin;
  } catch { throw new Error('Unsupported worker server endpoint'); }
  const client = OpenCode.make({ baseUrl: endpoint,
    headers: registration.password === undefined ? undefined : { authorization: 'Basic ' + Buffer.from(`opencode:${registration.password}`).toString('base64') },
    fetch: async (input, init) => {
      try {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== endpoint || !url.pathname.startsWith('/api/')) throw new Error();
        const response = await fetch(input, { ...init, redirect: 'error',
          signal: AbortSignal.any([signal, init?.signal, input instanceof Request ? input.signal : undefined, AbortSignal.timeout(30000)].filter(value => value != null)) });
        if (!response.ok) { await response.body?.cancel(); throw new Error(); }
        const reader = response.body?.getReader();
        const chunks = [];
        let size = 0;
        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 16 * 1024 * 1024) throw new Error();
              chunks.push(value);
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        const body = Buffer.concat(chunks);
        // Prevent malformed or error response bodies from entering SDK error causes.
        if (body.length) JSON.parse(body.toString('utf8'));
        return new Response(body.length ? body : null, { status: response.status, headers: response.headers });
      } catch { throw new Error('Pinned worker server request failed; remote settlement is unconfirmed'); }
    } });
  try {
    const info = await client.server.info({ signal });
    if (info?.pid !== registration.pid || typeof info.version !== 'string' ||
        registration.version !== undefined && info.version !== registration.version) throw new Error();
  } catch { throw new Error('Worker server discovery failed; no service was started'); }
  return { endpoint, client };
}
