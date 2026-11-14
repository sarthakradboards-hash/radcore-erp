// RC-214: the shell reads the session on the server, passing on only the person's cookie and client address.
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../api-client.ts';
import { readMe } from './read-me.ts';

const me = {
  user: { id: '0193b1c2-3d4e-7f80-9a1b-2c3d4e5f6a7b', displayName: 'Asha Rao' },
  permissions: ['parties:read', 'sales:write'],
  session: { idleExpiresAt: '2026-11-10T09:30:00Z', absoluteExpiresAt: '2026-11-10T17:00:00Z' },
  secondFactor: 'not_required',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const stub = (res: Response) => {
  const f = vi.fn<typeof fetch>(async () => res);
  vi.stubGlobal('fetch', f);
  return f;
};

afterEach(() => vi.unstubAllGlobals());

it("reads /me from the api with the person's cookie and address, never cached", async () => {
  const f = stub(reply(200, me));
  await expect(readMe({ cookie: 'sid=abc', forwardedFor: '203.0.113.7' }, 'http://10.0.0.10:3001/')).resolves.toEqual(me);
  const [url, init] = f.mock.calls[0]!;
  expect(url).toBe('http://10.0.0.10:3001/me');
  expect(init).toMatchObject({ method: 'GET', cache: 'no-store',
    headers: { cookie: 'sid=abc', 'x-forwarded-for': '203.0.113.7', accept: 'application/json' } });
});

it('sends no cookie header when the browser sent none', async () => {
  const f = stub(reply(200, me));
  await readMe({ cookie: null, forwardedFor: null }, 'http://api');
  expect(f.mock.calls[0]![1]?.headers).not.toHaveProperty('cookie');
});

it('answers null when nobody is signed in', async () => {
  stub(reply(401, { code: 'signed_out', message: 'Sign in again', issues: [], requestId: 'r' }));
  await expect(readMe({ cookie: 'sid=old', forwardedFor: null }, 'http://api')).resolves.toBeNull();
});

it('throws any other failure, for the error screen', async () => {
  stub(reply(500, { code: 'server_error', message: 'No', issues: [], requestId: 'r' }));
  await expect(readMe({ cookie: 'sid=abc', forwardedFor: null }, 'http://api')).rejects.toBeInstanceOf(ApiError);
});

it('refuses to run without API_INTERNAL_URL', async () => {
  await expect(readMe({ cookie: null, forwardedFor: null }, '')).rejects.toThrow(/API_INTERNAL_URL/);
});
