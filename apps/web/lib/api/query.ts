'use client';
// The data layer (M1-42, ADR-001 §7 and §7a): TanStack Query over the typed client. Screens read and save only
// through these four hooks. The option builders are exported so the tests drive them with TanStack's own observers.
import type { Contract } from '@radcore/lib-common';
import {
  infiniteQueryOptions, keepPreviousData, MutationCache, onlineManager, QueryCache, QueryClient, queryOptions,
  useInfiniteQuery, useMutation, useQuery, useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { ApiError, callContract } from '../api-client.ts';
import { noteSignedOut } from '../session/signed-out.ts';

type In<C extends Contract> = z.input<C['input']>;
type Out<C extends Contract> = z.output<C['output']>;
type ListIn = { filter: unknown; after?: string | undefined; limit: number };
/** A list's input without the paging fields, which the hooks manage. */
type ListParams<C extends Contract> = In<C> extends ListIn ? Omit<In<C>, 'after' | 'limit'> : never;
type Item<C extends Contract> = Out<C> extends { items: readonly (infer T)[] } ? T : never;
type Page<C extends Contract> = { items: Item<C>[]; next: string | null };

// Any answer from the server, a refusal included, proves the connection is up, whatever the browser's flag says.
const answered = <T>(p: Promise<T>): Promise<T> => p.then(
  (value) => { onlineManager.setOnline(true); return value; },
  (error: unknown) => { if (error instanceof ApiError) onlineManager.setOnline(true); throw error; },
);

// callContract's options depend on the contract's transaction, which a generic C can't resolve; these two say which.
const read = (c: Contract, input: unknown, signal: AbortSignal) => answered(
  (callContract as (c: Contract, i: unknown, o: { signal: AbortSignal }) => Promise<unknown>)(c, input, { signal }));
const write = (c: Contract, input: unknown, idempotencyKey: string) => answered(
  (callContract as (c: Contract, i: unknown, o: { idempotencyKey: string }) => Promise<unknown>)(c, input, { idempotencyKey }));

/** A query's key starts with the contract's route, so `invalidates: [listParties]` refreshes every page of it. */
export const keyOf = (c: Contract, input?: unknown) => (input === undefined ? [c.method, c.path] : [c.method, c.path, input]);

/** The most queries kept in memory. The oldest unused ones go first (RC-188: a bounded cache). */
export const MAX_QUERIES = 200;
/**
 * How often the shell refreshes the session, permissions and the bell (M1-42): `useApiQuery(me, {}, { refetchInterval: REFRESH_MS })`.
 * @public UI-kit API: its first caller is RAD-50's shell, which owns the /me and bell reads.
 */
export const REFRESH_MS = 60_000;

/** One client per browser tab. A refusal (4xx) isn't retried; a network failure or a 5xx is, twice.
 * Any read or save answered signed_out opens the signed-out dialog (RAD-55). */
export function makeQueryClient(): QueryClient {
  const cache = new QueryCache({ onError: noteSignedOut });
  cache.subscribe((event) => {
    if (event.type !== 'added') return;
    for (const q of cache.getAll()) { // insertion order, oldest first
      if (cache.getAll().length <= MAX_QUERIES) break;
      if (q.getObserversCount() === 0) cache.remove(q);
    }
  });
  return new QueryClient({
    queryCache: cache,
    mutationCache: new MutationCache({ onError: noteSignedOut }),
    defaultOptions: {
      queries: { retry: (failures, error) => failures < 2 && !(error instanceof ApiError && error.status < 500) },
    },
  });
}

const apiQueryOptions = <C extends Contract>(c: C, input: In<C>) => queryOptions({
  queryKey: keyOf(c, input),
  queryFn: ({ signal }) => read(c, input, signal) as Promise<Out<C>>,
});

export const apiListOptions = <C extends Contract>(c: C, params: ListParams<C>, limit: number) => infiniteQueryOptions({
  // A new filter or sort is a new key, so pages from the old one never show under it (RC-188).
  queryKey: keyOf(c, { ...params, limit }),
  initialPageParam: null as string | null,
  queryFn: ({ pageParam, signal }) =>
    read(c, { ...params, limit, ...(pageParam === null ? {} : { after: pageParam }) }, signal) as Promise<Page<C>>,
  getNextPageParam: (last: Page<C>) => last.next, // null: the last page
});

/** Resolves after `ms`, or rejects at once when the query is cancelled, so an overtaken keystroke sends nothing. */
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});

type SearchOptions<C extends Contract> = { params?: ListParams<C>; limit?: number; minChars?: number; debounceMs?: number };

/** The typed text goes in `filter.search`, the list convention for server search (A-4: never a fixed slice). */
export const apiSearchOptions = <C extends Contract>(c: C, text: string, o: SearchOptions<C> = {}) => {
  const params = (o.params ?? { filter: {} }) as { filter?: object };
  const input = { ...params, filter: { ...params.filter, search: text.trim() }, limit: o.limit ?? 20 };
  return queryOptions({
    queryKey: keyOf(c, input),
    // Changing the text moves the hook to a new query, and TanStack aborts this one: during the pause, or mid-fetch.
    queryFn: async ({ signal }) => {
      await pause(o.debounceMs ?? 250, signal);
      return read(c, input, signal) as Promise<Page<C>>;
    },
    enabled: text.trim().length >= (o.minChars ?? 1),
    placeholderData: keepPreviousData,
  });
};

/** The retry key for one form (ADR-001 §7a, RC-133): kept across retries of a submit, renewed only after a success. */
export function createSubmitKey(make: () => string = () => crypto.randomUUID()) {
  let key = make();
  return { get current() { return key; }, renew() { key = make(); } };
}

export const apiMutationOptions = <C extends Contract>(client: QueryClient, c: C, key: ReturnType<typeof createSubmitKey>,
  invalidates: readonly Contract[] = []) => {
  const saved = async () => {
    key.renew();
    await Promise.all(invalidates.map((r) => client.invalidateQueries({ queryKey: keyOf(r) })));
  };
  return {
    mutationFn: (input: In<C>) => write(c, input, key.current) as Promise<Out<C>>,
    onSuccess: saved,
    // The first attempt was saved but its answer was lost, and the form changed since. The error still reaches the
    // form ("already saved"), and the next submit is a new save with a new key, not the same refusal again.
    onError: async (error: Error) => {
      if (error instanceof ApiError && error.code === 'idempotency_mismatch') await saved();
    },
  };
};

/**
 * One read. `error` is an ApiError when the server answered, or another Error when it couldn't be reached.
 * @public UI-kit API: first callers are RAD-50 (the shell's /me refresh), RAD-53 and RAD-54.
 */
export function useApiQuery<C extends Contract>(c: C, input: In<C>,
  opts: { enabled?: boolean; refetchInterval?: number; staleTime?: number; initialData?: Out<C> } = {}) {
  return useQuery({ ...apiQueryOptions(c, input), ...opts });
}

/**
 * A paged list over the `{ items, next }` envelope. A new `params` value starts again from the first page.
 * @public UI-kit API: first callers are RAD-54's tables.
 */
export function useApiList<C extends Contract>(c: C, params: ListParams<C>,
  opts: { limit?: number; enabled?: boolean } = {}) {
  const q = useInfiniteQuery({ ...apiListOptions(c, params, opts.limit ?? 50), enabled: opts.enabled ?? true });
  return {
    items: q.data?.pages.flatMap((p) => p.items) ?? [],
    pages: q.data?.pages ?? [],
    fetchNextPage: () => void q.fetchNextPage(),
    hasNextPage: q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    isPending: q.isPending,
    error: q.error,
    refetch: () => void q.refetch(),
  };
}

/**
 * Server search for a picker: debounced, the stale request aborted, the last answer kept on screen while typing.
 * Only the first page: a picker shows the top `limit` matches and the person narrows by typing.
 * @public UI-kit API: first callers are RAD-54's pickers.
 */
export function useApiSearch<C extends Contract>(c: C, text: string, opts: SearchOptions<C> = {}) {
  const options = apiSearchOptions(c, text, opts);
  const q = useQuery(options);
  // keepPreviousData would otherwise keep showing matches for text the person has just cleared.
  return { items: options.enabled ? q.data?.items ?? [] : [], isFetching: q.isFetching, error: q.error };
}

/**
 * A save. It owns the Idempotency-Key: one per submit, the same on a retry, a new one only after a success.
 * `submit` rejects with the error, so a form can map `error.envelope.issues` to its fields.
 * @public UI-kit API: first callers are RAD-53's forms.
 */
export function useApiMutation<C extends Contract>(c: C, opts: { invalidates?: readonly Contract[] } = {}) {
  const client = useQueryClient();
  const [key] = useState(() => createSubmitKey());
  const m = useMutation(apiMutationOptions(client, c, key, opts.invalidates));
  return { submit: m.mutateAsync, isPending: m.isPending, error: m.error, reset: m.reset };
}
