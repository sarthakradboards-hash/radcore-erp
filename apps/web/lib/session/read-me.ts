// The session, read on the web server before the first byte (RC-214: no "Loading..." round trip). ADR-004 §3: web's
// server components call only read contracts on the api, at API_INTERNAL_URL, passing on the person's cookie and the
// client address Caddy gave them. Imported only by server components (app/(app)/layout.tsx).
import type { z } from 'zod';
import { ApiError, createClient } from '../api-client.ts';
import { getMe } from './get-me.ts';

export type Me = z.output<typeof getMe.output>;

type IncomingRequest = { cookie: string | null; forwardedFor: string | null };

/** Who is signed in, or null when nobody is (401 `signed_out`). Any other failure throws to the error screen. */
export async function readMe(request: IncomingRequest, apiUrl = process.env['API_INTERNAL_URL']): Promise<Me | null> {
  if (!apiUrl) throw new Error('API_INTERNAL_URL is not set: the web server reads the session from the api there (ADR-004 §5)');
  const forward: Record<string, string> = {};
  if (request.cookie) forward['cookie'] = request.cookie;
  if (request.forwardedFor) forward['x-forwarded-for'] = request.forwardedFor;
  const api = createClient({ getMe }, {
    baseUrl: apiUrl.replace(/\/$/, ''),
    // A session answer is per person and per moment, so never from any cache.
    fetch: (url, init) => fetch(url, { ...init, cache: 'no-store', headers: { ...(init?.headers as Record<string, string>), ...forward } }),
  });
  try {
    return await api.getMe({});
  } catch (e) {
    if (e instanceof ApiError && e.code === 'signed_out') return null;
    throw e;
  }
}
