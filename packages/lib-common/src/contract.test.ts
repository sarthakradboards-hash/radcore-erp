import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  checkInput, defineContract, errorEnvelope, gstinString, idString, listInput, listOf, MAX_LIMIT, readInput, requestFor,
} from './index.ts';

const Party = z.object({ id: idString(), name: z.string(), gstin: gstinString().nullable() });
const createParty = defineContract({
  method: 'POST', path: '/accounts/parties', auth: 'session', perm: 'parties:write',
  tx: { readOnly: false, isolation: 'read committed' },
  input: z.object({ name: z.string().min(1), gstin: gstinString().optional() }), output: Party,
  errors: ['gstin_already_used'],
});
const getParty = defineContract({
  method: 'GET', path: '/accounts/parties/:id', auth: 'session', perm: 'parties:read',
  tx: { readOnly: true, isolation: 'read committed' }, input: z.object({ id: idString() }), output: Party,
});
const listParties = defineContract({
  method: 'GET', path: '/accounts/parties', auth: 'session', perm: 'parties:read',
  tx: { readOnly: true, isolation: 'read committed' }, input: listInput(z.object({ q: z.string().optional() })),
  output: listOf(Party),
});
const ID = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';

describe('defineContract refuses a contract that breaks a rule', () => {
  const base = { method: 'POST', path: '/x', auth: 'session', perm: 'x:write',
    tx: { readOnly: false, isolation: 'read committed' }, input: z.object({}), output: z.object({}) } as const;

  it.each([
    ['a path with capitals', { path: '/Sales' }],
    ['a path without a slash', { path: 'sales' }],
    ['a path parameter not in the input', { path: '/x/:id' }],
    ['a zero statement timeout (RC-080)', { tx: { readOnly: false, isolation: 'read committed', statementTimeoutMs: 0 } }],
    ['a fractional statement timeout', { tx: { readOnly: false, isolation: 'read committed', statementTimeoutMs: 1.5 } }],
    ['a platform code as its own', { errors: ['not_found'] }],
    ['an error code that is not snake_case', { errors: ['CreditLimit'] }],
    ['an error code twice', { errors: ['a_b', 'a_b'] }],
    ['a transform in the input', { input: z.object({ n: z.string().transform((s) => s.length) }) }],
    ['a default in the input', { input: z.object({ n: z.string().default('x') }) }],
    ['a pipe to another type', { input: z.object({ n: z.string().pipe(z.coerce.number()) }) }],
    ['a Date in the output', { output: z.object({ at: z.date() }) }],
  ])('%s', (_, change) => {
    expect(() => defineContract({ ...base, ...change } as typeof base)).toThrow(TypeError);
  });

  it('refuses a writing GET and a repeatable-read write even past the types', () => {
    // As plain JavaScript would call it: the types refuse both, so this is the runtime half.
    const untyped = defineContract as (spec: object) => unknown;
    expect(() => untyped({ ...base, method: 'GET' })).toThrow(/read-only/);
    expect(() => untyped({ ...base, tx: { readOnly: false, isolation: 'repeatable read' } })).toThrow(/read committed/);
  });

  it('keeps the declaration as data, frozen', () => {
    expect(createParty).toMatchObject({ method: 'POST', perm: 'parties:write', errors: ['gstin_already_used'], params: [] });
    expect(getParty.params).toEqual(['id']);
    expect(Object.isFrozen(createParty)).toBe(true);
  });
});

describe('the request goes and comes back the same way', () => {
  it('puts a write in the body', () => {
    expect(requestFor(createParty, { name: 'Asha Motors' }))
      .toEqual({ method: 'POST', path: '/accounts/parties', body: '{"name":"Asha Motors"}' });
  });

  it('puts path parameters in the path and a read in ?input=', () => {
    expect(requestFor(getParty, { id: ID })).toEqual({ method: 'GET', path: `/accounts/parties/${ID}`, body: undefined });
    const sent = requestFor(listParties, { filter: { q: 'a&b' }, limit: 50 });
    expect(sent.path).toBe(`/accounts/parties?input=${encodeURIComponent('{"filter":{"q":"a&b"},"limit":50}')}`);
    const query = new URL(sent.path, 'http://x').searchParams.get('input') ?? undefined;
    expect(readInput(listParties, { params: {}, query })).toEqual({ ok: true, value: { filter: { q: 'a&b' }, limit: 50 } });
  });

  it('escapes a path parameter and reads it back', () => {
    const odd = defineContract({ ...getParty, input: z.object({ id: z.string() }) });
    expect(requestFor(odd, { id: 'a/b?c' }).path).toBe('/accounts/parties/a%2Fb%3Fc');
    expect(() => requestFor(odd, { id: '' })).toThrow(TypeError);
  });

  it('takes the path parameter from the path, not the body', () => {
    expect(readInput(getParty, { params: { id: ID }, query: JSON.stringify({ id: 'other' }) }))
      .toEqual({ ok: true, value: { id: ID } });
  });

  it('answers bad JSON and a limit over 200 with invalid_input', () => {
    expect(readInput(listParties, { params: {}, query: '{oops' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    const r = checkInput(listParties, { filter: {}, limit: MAX_LIMIT + 1 });
    expect(r.ok ? [] : r.error.issues.map((i) => i.path)).toEqual([['limit']]);
    expect(checkInput(listParties, { filter: {}, limit: 10, after: 'not a cursor!' }).ok).toBe(false);
  });
});

describe('RC-186: one GSTIN rule for every side', () => {
  it('refuses a 14-character GSTIN with an issue on the field', () => {
    const r = checkInput(createParty, { name: 'Asha Motors', gstin: '27AAPFU0939F1Z' });
    expect(r).toEqual({ ok: false, error: { code: 'invalid_input', message: 'Some of what was sent needs correcting',
      issues: [{ path: ['gstin'], code: 'custom', message: 'Enter a valid 15-character GSTIN, in capitals' }] } });
    expect(errorEnvelope.safeParse(r.ok ? null : { ...r.error, requestId: 'r1' }).success).toBe(true);
    expect(checkInput(createParty, { name: 'Asha Motors', gstin: '27AAPFU0939F1ZV' }).ok).toBe(true);
  });
});

describe('retryAfterSeconds (RAD-61)', () => {
  const env = { message: 'Wait', issues: [], requestId: 'r1' };
  it.each([['rate_limited', 30, true], ['account_locked', 900, true], ['not_found', 30, false], ['rate_limited', 0, false],
    ['rate_limited', 1.5, false]])('%s with %s seconds is %s', (code, retryAfterSeconds, ok) => {
    expect(errorEnvelope.safeParse({ ...env, code, retryAfterSeconds }).success).toBe(ok);
  });
  it('is optional', () => expect(errorEnvelope.safeParse({ ...env, code: 'rate_limited' }).success).toBe(true));
});
