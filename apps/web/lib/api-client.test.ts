// RC-186, web side: the form's submit goes through createClient, which checks the input with the contract's own
// schema, so a bad GSTIN is refused with the same issue as the API (apps/api/src/gstin-proof.test.ts) and never sent.
import { defineContract, gstinString, listInput, listOf } from '@radcore/lib-common';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, callContract, createClient } from './api-client';

const Party = z.object({ id: z.string(), name: z.string() });
const contracts = {
  createParty: defineContract({
    method: 'POST', path: '/accounts/parties', auth: 'session', perm: 'parties:write',
    tx: { readOnly: false, isolation: 'read committed' },
    input: z.object({ name: z.string().min(1), gstin: gstinString() }), output: Party, errors: ['gstin_already_used'],
  }),
  listParties: defineContract({
    method: 'GET', path: '/accounts/parties', auth: 'session', perm: 'parties:read',
    tx: { readOnly: true, isolation: 'read committed' }, input: listInput(z.object({})), output: listOf(Party),
  }),
};
const idemKey = crypto.randomUUID(); // as the form makes one per submit
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const setup = (res: Response) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => res);
  return { fetch, api: createClient(contracts, { fetch }) };
};

describe('RC-186: the web form refuses a bad GSTIN', () => {
  it('refuses before sending, with the issue on the gstin field', async () => {
    const { fetch, api } = setup(reply(200, {}));
    const err = await api.createParty({ name: 'Asha Motors', gstin: '27AAPFU0939F1Z' }, { idempotencyKey: idemKey })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    if (!(err instanceof ApiError)) return;
    expect(err.code).toBe('invalid_input');
    expect(err.envelope.issues).toEqual([{ path: ['gstin'], code: 'custom', message: 'Enter a valid 15-character GSTIN, in capitals' }]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('createClient', () => {
  it('sends a write with its key and returns the typed answer', async () => {
    const { fetch, api } = setup(reply(200, { id: 'p1', name: 'Asha Motors' }));
    const party = await api.createParty({ name: 'Asha Motors', gstin: '27AAPFU0939F1ZV' }, { idempotencyKey: idemKey });
    expect(party.name).toBe('Asha Motors');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('/api/accounts/parties');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin',
      headers: { 'idempotency-key': idemKey, 'content-type': 'application/json' } });
  });

  it('refuses a write without a usable key (RC-132), sending nothing', async () => {
    const { fetch, api } = setup(reply(200, {}));
    const input = { name: 'Asha Motors', gstin: '27AAPFU0939F1ZV' };
    await expect(api.createParty(input, { idempotencyKey: 'x' })).rejects.toMatchObject({ code: 'idempotency_key_required' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads a list with a GET and no key', async () => {
    const { fetch, api } = setup(reply(200, { items: [], next: null }));
    expect(await api.listParties({ filter: {}, limit: 50 })).toEqual({ items: [], next: null });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`/api/accounts/parties?input=${encodeURIComponent('{"filter":{},"limit":50}')}`);
    expect(init?.headers).not.toHaveProperty('idempotency-key');
  });

  it("throws the server's envelope, typed by code", async () => {
    const env = { code: 'gstin_already_used', message: 'Another party has this GSTIN', issues: [], requestId: 'r9' };
    const { api } = setup(reply(422, env));
    await expect(api.createParty({ name: 'A', gstin: '27AAPFU0939F1ZV' }, { idempotencyKey: idemKey }))
      .rejects.toMatchObject({ status: 422, code: 'gstin_already_used', envelope: env });
  });

  it('turns an answer that is not an envelope into server_error', async () => {
    const { api } = setup(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.listParties({ filter: {}, limit: 1 })).rejects.toMatchObject({ status: 502, code: 'server_error' });
  });
});

describe('review additions', () => {
  it('passes a read\'s signal to fetch, so a stale search can be cancelled (RC-188)', async () => {
    const { fetch, api } = setup(reply(200, { items: [], next: null }));
    const ctl = new AbortController();
    await api.listParties({ filter: {}, limit: 5 }, { signal: ctl.signal });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(ctl.signal);
  });

  it('passes a write\'s signal to fetch alongside its key', async () => {
    const { fetch, api } = setup(reply(200, { id: 'p1', name: 'A' }));
    const ctl = new AbortController();
    await api.createParty({ name: 'A', gstin: '27AAPFU0939F1ZV' }, { idempotencyKey: idemKey, signal: ctl.signal });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ signal: ctl.signal, headers: { 'idempotency-key': idemKey } });
  });

  it('calls one contract directly, with the same defaults as createClient', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => reply(200, { items: [], next: null }));
    vi.stubGlobal('fetch', fetch);
    try {
      expect(await callContract(contracts.listParties, { filter: {}, limit: 5 })).toEqual({ items: [], next: null });
      expect(fetch.mock.calls[0]?.[0]).toMatch(/^\/api\/accounts\/parties\?input=/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hands the screen retryAfterSeconds on rate_limited (RAD-61)', async () => {
    const env = { code: 'rate_limited', message: 'Too many tries. Wait a minute.', issues: [], requestId: 'r1', retryAfterSeconds: 60 };
    const { api } = setup(reply(429, env));
    await expect(api.listParties({ filter: {}, limit: 5 })).rejects.toMatchObject({ code: 'rate_limited',
      envelope: { retryAfterSeconds: 60 } });
  });
});
