// RAD-55 / RAD-52: sign-out ends the session without a retry key, clears only this person's drafts, then reloads.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { drafts } from '../../lib/offline/drafts.ts';
import { signOutAndLeave } from './sign-out.tsx';

const memoryStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(),
  };
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage());
  drafts.save('u1', 'party', { name: 'Asha' });
  drafts.save('u2', 'party', { name: 'Ravi' });
});
afterEach(() => vi.unstubAllGlobals());

it('ends the session with no Idempotency-Key, clears only my drafts, and reloads to sign-in', async () => {
  const fetch = vi.fn(async () => reply(200, {}));
  vi.stubGlobal('fetch', fetch);
  const go = vi.fn();
  await signOutAndLeave('u1', go);
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect([url, init.method]).toEqual(['/api/sign-out', 'POST']);
  expect(init.headers).not.toHaveProperty('idempotency-key');
  expect([drafts.load('u1', 'party'), drafts.load('u2', 'party')]).toEqual([null, { name: 'Ravi' }]);
  expect(go).toHaveBeenCalledWith('/sign-in');
});

it('still leaves when the session had already ended', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(401, { code: 'signed_out', message: 'Sign in again', issues: [], requestId: 'r' })));
  const go = vi.fn();
  await signOutAndLeave('u1', go);
  expect(go).toHaveBeenCalledWith('/sign-in');
});

it('stays, and keeps the drafts, when the server could not end it', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  const go = vi.fn();
  await expect(signOutAndLeave('u1', go)).rejects.toBeInstanceOf(TypeError);
  expect(drafts.load('u1', 'party')).toEqual({ name: 'Asha' });
  expect(go).not.toHaveBeenCalled();
});
