import { api, scopedSession } from './api.js';

/** @param {import('./loops.js').Job} job @param {typeof api} [request] */
export async function deliverWakeup(job, request = api) {
  const session = await scopedSession(job.directory, job.sessionID, request);
  if (session.time.archived || session.agent !== 'poteto') throw new Error('Session archived or no longer using primary poteto');
  const decision = await request('post', `/api/session/${job.sessionID}/permission`, {
    action: 'pstack_wakeup', resources: [job.id], agent: session.agent,
  });
  if (decision.data.effect !== 'allow') {
    if (decision.data.effect === 'ask') await request('post', `/api/session/${job.sessionID}/permission/${decision.data.id}/reply`, { decision: 'reject' });
    throw new Error('Wakeup permission is not allow; schedule paused');
  }
  const inbox = await request('get', `/api/session/${job.sessionID}/inbox`);
  if (inbox.data.some((/** @type {any} */ item) => item.payload?.metadata?.pstackLoop === job.id)) throw new Error('Previous wakeup still pending');
  if (Date.now() >= job.expiresAt) throw new Error('Schedule expired during preflight; no prompt admitted');
  const response = await request('post', `/api/session/${job.sessionID}/prompt`, {
    text: `[Scheduled pstack check. Scope and permissions are unchanged. Cancel the schedule when its stop condition is met.]\n${job.prompt}`,
    delivery: 'queue', metadata: { pstackLoop: job.id },
  });
  return response.data.id;
}
