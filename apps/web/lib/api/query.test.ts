// The data layer's rules (M1-42), driven through TanStack's own observers, so no DOM is needed:
// RC-133 the retry key, RC-188 search, paging and the bounded cache.
import { defineContract, listInput, listOf } from '@radcore/lib-common';
import { InfiniteQueryObserver, MutationObserver, onlineManager, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../api-client.ts';
import {
  apiListOptions, apiMutationOptions, apiSearchOptions, createSubmitKey, keyOf, makeQueryClient, MAX_QUERIES,
} from './query.ts';

const Party = z.object({ id: z.string(), name: z.string() });
const listParties = defineContract({
  method: 'GET', path: '/accounts/parties', auth: 'session', perm: 'parties:read',
  tx: { readOnly: true, isolation: 'read committed' },
  input: listInput(z.object({ search: z.string().optional(), city: z.string().optional() })), output: listOf(Party),
});
const createParty = defineContract({
  method: 'POST', path: '/accounts/parties', auth: 'session', perm: 'parties:write',
  tx: { readOnly: false, isolation: 'read committed' }, input: z.object({ name: z.string() }), output: Party,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const failure = (status: number) => json(status, { code: 'server_error', message: 'No', issues: [], requestId: 'r' });
const stubFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  const f = vi.fn(impl);
  vi.stubGlobal('fetch', f);
  return f;
};
const sentInput = (url: string): unknown => JSON.parse(new URL(url, 'http://x').searchParams.get('input') ?? 'null');
const keyHeader = (init: RequestInit | undefined) => (init?.headers as Record<string, string>)['idempotency-key'];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RC-133: one Idempotency-Key per submit', () => {
  it('keeps the key across failed attempts and renews it only after a success', async () => {
    const replies = [failure(500), failure(503), json(200, { id: 'p1', name: 'Asha' }), json(200, { id: 'p2', name: 'B' })];
    const fetch = stubFetch(async () => replies.shift()!);
    const client = makeQueryClient();
    const obs = new MutationObserver(client, apiMutationOptions(client, createParty, createSubmitKey()));

    await expect(obs.mutate({ name: 'Asha' })).rejects.toBeInstanceOf(ApiError);
    await expect(obs.mutate({ name: 'Asha' })).rejects.toBeInstanceOf(ApiError);
    await obs.mutate({ name: 'Asha' });
    await obs.mutate({ name: 'B' }); // the next submit, after a success

    const keys = fetch.mock.calls.map(([, init]) => keyHeader(init));
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys.slice(0, 3)).toEqual([keys[0], keys[0], keys[0]]);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it('refreshes the lists it names after a success', async () => {
    stubFetch(async () => json(200, { id: 'p1', name: 'Asha' }));
    const client = makeQueryClient();
    const listKey = keyOf(listParties, { filter: {}, limit: 50 });
    client.setQueryData(listKey, { pages: [], pageParams: [] });
    const obs = new MutationObserver(client, apiMutationOptions(client, createParty, createSubmitKey(), [listParties]));
    await obs.mutate({ name: 'Asha' });
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it('treats idempotency_mismatch as already saved: the error reaches the form, the lists refresh, the key renews', async () => {
    const mismatch = json(409, { code: 'idempotency_mismatch', message: 'Already saved', issues: [], requestId: 'r' });
    const replies = [mismatch, json(200, { id: 'p2', name: 'Asha B' })];
    const fetch = stubFetch(async () => replies.shift()!);
    const client = makeQueryClient();
    const listKey = keyOf(listParties, { filter: {}, limit: 50 });
    client.setQueryData(listKey, { pages: [], pageParams: [] });
    const obs = new MutationObserver(client, apiMutationOptions(client, createParty, createSubmitKey(), [listParties]));

    await expect(obs.mutate({ name: 'Asha B' })).rejects.toMatchObject({ code: 'idempotency_mismatch' });
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    await obs.mutate({ name: 'Asha B' });
    const [first, second] = fetch.mock.calls.map(([, init]) => keyHeader(init));
    expect(second).not.toBe(first);
  });

  it('keeps the key after any other refusal', async () => {
    const replies = [json(409, { code: 'conflict', message: 'Changed', issues: [], requestId: 'r' }), json(200, { id: 'p1', name: 'A' })];
    const fetch = stubFetch(async () => replies.shift()!);
    const client = makeQueryClient();
    const obs = new MutationObserver(client, apiMutationOptions(client, createParty, createSubmitKey()));
    await expect(obs.mutate({ name: 'A' })).rejects.toBeInstanceOf(ApiError);
    await obs.mutate({ name: 'A' });
    const [first, second] = fetch.mock.calls.map(([, init]) => keyHeader(init));
    expect(second).toBe(first);
  });
});

describe('RC-188: lists', () => {
  it('pages with after = the previous next, and stops at null', async () => {
    const fetch = stubFetch(async (url) => {
      const after = (sentInput(url) as { after?: string }).after;
      return json(200, after === undefined
        ? { items: [{ id: '1', name: 'A' }], next: 'cursor1' }
        : { items: [{ id: '2', name: 'B' }], next: null });
    });
    const client = makeQueryClient();
    const obs = new InfiniteQueryObserver(client, apiListOptions(listParties, { filter: {} }, 1));
    const unsubscribe = obs.subscribe(() => {});
    await vi.waitFor(() => expect(obs.getCurrentResult().isSuccess).toBe(true));
    expect(obs.getCurrentResult().hasNextPage).toBe(true);
    await obs.fetchNextPage();

    expect(fetch.mock.calls.map(([url]) => sentInput(url))).toEqual([
      { filter: {}, limit: 1 }, { filter: {}, limit: 1, after: 'cursor1' },
    ]);
    expect(obs.getCurrentResult().data?.pages.flatMap((p) => p.items).map((p) => p.id)).toEqual(['1', '2']);
    expect(obs.getCurrentResult().hasNextPage).toBe(false);
    unsubscribe();
  });

  it('shows no page from the old filter under a new one', async () => {
    stubFetch(async () => json(200, { items: [{ id: '1', name: 'A' }], next: null }));
    const client = makeQueryClient();
    const obs = new InfiniteQueryObserver(client, apiListOptions(listParties, { filter: { city: 'Pune' } }, 50));
    const unsubscribe = obs.subscribe(() => {});
    await vi.waitFor(() => expect(obs.getCurrentResult().isSuccess).toBe(true));
    obs.setOptions(apiListOptions(listParties, { filter: { city: 'Nashik' } }, 50));
    expect(obs.getCurrentResult().data).toBeUndefined();
    unsubscribe();
  });
});

describe('RC-188: server search', () => {
  it('sends one request for a burst of keystrokes, with the last text', async () => {
    vi.useFakeTimers();
    const fetch = stubFetch(async () => json(200, { items: [], next: null }));
    const client = makeQueryClient();
    const obs = new QueryObserver(client, apiSearchOptions(listParties, 'a'));
    const unsubscribe = obs.subscribe(() => {});
    for (const text of ['as', 'ash', 'asha']) {
      await vi.advanceTimersByTimeAsync(100);
      obs.setOptions(apiSearchOptions(listParties, text));
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(fetch.mock.calls.map(([url]) => sentInput(url))).toEqual([{ filter: { search: 'asha' }, limit: 20 }]);
    unsubscribe();
  });

  it('aborts a request in flight when the text changes', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      signals.push(init.signal!);
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    const client = makeQueryClient();
    const obs = new QueryObserver(client, apiSearchOptions(listParties, 'ash'));
    const unsubscribe = obs.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(300);
    expect(signals).toHaveLength(1);
    obs.setOptions(apiSearchOptions(listParties, 'asha'));
    expect(signals[0]!.aborted).toBe(true);
    unsubscribe();
  });

  it('sends nothing for empty text', async () => {
    vi.useFakeTimers();
    const fetch = stubFetch(async () => json(200, { items: [], next: null }));
    const obs = new QueryObserver(makeQueryClient(), apiSearchOptions(listParties, '  '));
    const unsubscribe = obs.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('the online state heals from a server answer (e2e on RAD-52)', () => {
  afterEach(() => onlineManager.setOnline(true));
  // networkMode 'always' lets the request run while the state says offline, as a stuck state would otherwise block it.
  const save = (client: ReturnType<typeof makeQueryClient>) => new MutationObserver(client,
    { ...apiMutationOptions(client, createParty, createSubmitKey()), networkMode: 'always' }).mutate({ name: 'A' });

  it('a success or a refusal marks it online', async () => {
    const replies = [json(200, { id: 'p1', name: 'A' }), failure(500)];
    stubFetch(async () => replies.shift()!);
    const client = makeQueryClient();
    onlineManager.setOnline(false);
    await save(client);
    expect(onlineManager.isOnline()).toBe(true);
    onlineManager.setOnline(false);
    await expect(save(client)).rejects.toBeInstanceOf(ApiError);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('a network failure does not', async () => {
    stubFetch(async () => { throw new TypeError('Failed to fetch'); });
    onlineManager.setOnline(false);
    await expect(save(makeQueryClient())).rejects.toBeInstanceOf(TypeError);
    expect(onlineManager.isOnline()).toBe(false);
  });
});

describe('the query client', () => {
  it('keeps at most MAX_QUERIES, dropping the oldest unused first', () => {
    const client = makeQueryClient();
    const watched = new QueryObserver(client, { queryKey: ['q', 0], queryFn: () => 0, enabled: false });
    const unsubscribe = watched.subscribe(() => {});
    for (let i = 1; i <= MAX_QUERIES + 5; i++) client.setQueryData(['q', i], i);
    const cache = client.getQueryCache();
    expect(cache.getAll()).toHaveLength(MAX_QUERIES);
    expect(cache.find({ queryKey: ['q', 0] })).toBeDefined(); // in use, so kept
    expect(cache.find({ queryKey: ['q', 1] })).toBeUndefined(); // the oldest unused
    unsubscribe();
  });

  it("retries a network failure or a 5xx twice, and a refusal never", () => {
    const retry = makeQueryClient().getDefaultOptions().queries?.retry as (n: number, e: Error) => boolean;
    const refused = new ApiError(404, { code: 'not_found', message: 'No', issues: [], requestId: 'r' });
    const broken = new ApiError(503, { code: 'server_error', message: 'No', issues: [], requestId: 'r' });
    expect(retry(0, refused)).toBe(false);
    expect([retry(0, broken), retry(1, broken), retry(2, broken)]).toEqual([true, true, false]);
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true);
  });
});
