// RC-147 (RAD-55): any read or save answered signed_out opens the signed-out dialog; nothing else does.
import { defineContract } from '@radcore/lib-common';
import { MutationObserver, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, callContract } from '../api-client.ts';
import { makeQueryClient } from '../api/query.ts';
import { clearSignedOut, isSignedOut, noteSignedOut } from './signed-out.ts';

const getThing = defineContract({
  method: 'GET', path: '/things', auth: 'session', perm: 'things:read', tx: { readOnly: true, isolation: 'read committed' },
  input: z.object({}), output: z.object({}),
});
const saveThing = defineContract({
  method: 'POST', path: '/things', auth: 'session', perm: 'things:write', tx: { readOnly: false, isolation: 'read committed' },
  input: z.object({}), output: z.object({}),
});
const envelope = (code: string) => ({ code, message: 'No', issues: [], requestId: 'r' });
const answer = (status: number, code: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(envelope(code)), { status })));

afterEach(() => {
  vi.unstubAllGlobals();
  clearSignedOut();
});

it('opens only for signed_out, and closes when cleared', () => {
  noteSignedOut(new ApiError(403, envelope('forbidden')));
  noteSignedOut(new TypeError('Failed to fetch'));
  expect(isSignedOut()).toBe(false);
  noteSignedOut(new ApiError(401, envelope('signed_out')));
  expect(isSignedOut()).toBe(true);
  clearSignedOut();
  expect(isSignedOut()).toBe(false);
});

it('opens when a read through the query client is answered signed_out', async () => {
  answer(401, 'signed_out');
  const read = new QueryObserver(makeQueryClient(), { queryKey: ['GET', '/things'], queryFn: () => callContract(getThing, {}) });
  const unsubscribe = read.subscribe(() => {});
  await vi.waitFor(() => expect(isSignedOut()).toBe(true));
  unsubscribe();
});

it('opens when a save is answered signed_out, but not for another refusal', async () => {
  const save = (client = makeQueryClient()) => new MutationObserver(client,
    { mutationFn: () => callContract(saveThing, {}, { idempotencyKey: crypto.randomUUID() }) }).mutate().catch(() => undefined);
  answer(403, 'forbidden');
  await save();
  expect(isSignedOut()).toBe(false);
  answer(401, 'signed_out');
  await save();
  expect(isSignedOut()).toBe(true);
});
