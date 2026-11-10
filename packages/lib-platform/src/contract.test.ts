// RAD-34's /me contract, declared ahead of the sessions service: its shape is what ui builds RAD-50, RAD-52 and
// RAD-55 against, and the same schema refuses a bad answer on both sides.
import { requestFor } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import * as contracts from './contract.ts';
import {
  ANSWER_NOT_STORED_ROUTES, confirmSecondFactorEnrolment, endMySession, getMe, KEY_EXEMPT_ROUTES, listMySessions,
  requestPasswordReset, signIn, signOut, startSecondFactorEnrolment, verifySecondFactor,
} from './contract.ts';

const me = {
  user: { id: '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01', displayName: 'Asha Rao' },
  permissions: ['parties:read', 'sales:write', 'session:read'],
  session: { idleExpiresAt: '2026-11-10T06:30:00Z', absoluteExpiresAt: '2026-11-10T17:00:00Z' },
  secondFactor: 'not_required',
};

describe('getMe', () => {
  it('is a read-only GET /me for any signed-in person, with no input', () => {
    expect(getMe).toMatchObject({ method: 'GET', path: '/me', auth: 'session', perm: 'session:read',
      tx: { readOnly: true, isolation: 'read committed' }, params: [], errors: [] });
    expect(requestFor(getMe, {})).toEqual({ method: 'GET', path: '/me', body: undefined });
  });

  it('accepts the answer ui builds against', () => {
    expect(getMe.output.parse(me)).toEqual(me);
    for (const secondFactor of ['enrolled', 'enrolment_required']) {
      expect(getMe.output.safeParse({ ...me, secondFactor }).success).toBe(true);
    }
  });

  it.each<[string, object]>([
    ['a user id that is not a UUID', { user: { ...me.user, id: 'u1' } }],
    ['a local time instead of a UTC moment', { session: { ...me.session, idleExpiresAt: '2026-11-10 12:00' } }],
    ['unsorted permissions', { permissions: ['sales:write', 'parties:read'] }],
    ['a permission twice', { permissions: ['sales:write', 'sales:write'] }],
    ['an unknown second-factor state', { secondFactor: 'skipped' }],
  ])('refuses %s', (_, change) => {
    expect(getMe.output.safeParse({ ...me, ...change }).success).toBe(false);
  });

  it('drops a field it does not declare, so an email or phone never reaches the browser', () => {
    const extra = { ...me, user: { ...me.user, email: 'asha@example.com' }, phone: '9876543210' };
    expect(getMe.output.parse(extra)).toEqual(me);
  });
});

// RAD-32, RAD-33 and RAD-34's own-account routes, to ui's shapes on RAD-32 with the architect's answers there.
describe('the sign-in and own-session contracts', () => {
  const declared = Object.values(contracts).filter((c): c is typeof signIn => typeof c === 'object' && 'path' in c);
  const route = (c: { method: string; path: string }) => `${c.method} ${c.path}`;

  it("lists exactly the routes that declare each saved-once flag (ADR-001 §7a's fixed lists)", () => {
    expect(declared.filter((c) => c.idempotency === 'exempt').map(route).sort()).toEqual([...KEY_EXEMPT_ROUTES].sort());
    expect(declared.filter((c) => c.storeAnswer === false).map(route)).toEqual([...ANSWER_NOT_STORED_ROUTES]);
    expect(KEY_EXEMPT_ROUTES).toHaveLength(4);
  });

  it('keeps reads on session:read and your own writes on session:write (RAD-32)', () => {
    expect([getMe, listMySessions].map((c) => c.perm)).toEqual(['session:read', 'session:read']);
    expect([signOut, endMySession].map((c) => c.perm)).toEqual(['session:write', 'session:write']);
    expect(declared.filter((c) => !c.tx.readOnly && c.auth === 'session').every((c) => c.perm === 'session:write')).toBe(true);
  });

  it('answers sign-in in two steps, and gives an unknown email and a wrong password one code', () => {
    for (const next of ['done', 'second_factor', 'enrol_second_factor']) {
      expect(signIn.output.safeParse({ next }).success).toBe(true);
    }
    expect(signIn.output.safeParse({ next: 'totp' }).success).toBe(false);
    expect(signIn.errors).toEqual(['invalid_credentials']);
    expect(signIn.input.safeParse({ email: 'asha@example.com', password: 'x' }).success).toBe(true); // no length rule
  });

  it('takes a TOTP code or a recovery code at the second step, and nothing else', () => {
    expect(verifySecondFactor.input.safeParse({ kind: 'totp', code: '123456' }).success).toBe(true);
    expect(verifySecondFactor.input.safeParse({ kind: 'recovery', code: 'abcd-efgh-ijkl' }).success).toBe(true);
    expect(verifySecondFactor.input.safeParse({ kind: 'totp', code: '12345' }).success).toBe(false);
    expect(verifySecondFactor.input.safeParse({ kind: 'password', code: '123456' }).success).toBe(false);
  });

  it('enrols a second factor: a secret not stored by saved-once, then ten recovery codes that finish signing in', () => {
    expect(startSecondFactorEnrolment.storeAnswer).toBe(false);
    expect(confirmSecondFactorEnrolment.idempotency).toBe('exempt');
    expect(confirmSecondFactorEnrolment.output.safeParse({ recoveryCodes: Array(9).fill('a') }).success).toBe(false);
  });

  it('asks for a reset by email alone, and refuses to end the current session (sign-out does that)', () => {
    expect(requestPasswordReset.input.safeParse({ email: 'not an email' }).success).toBe(false);
    expect(requestPasswordReset.errors).toEqual([]);
    expect(endMySession).toMatchObject({ method: 'DELETE', params: ['id'], errors: ['current_session'] });
  });

  it('lists your sessions with no IP, only a short device name', () => {
    const item = { id: '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01', current: true, createdAt: '2026-11-10T06:00:00Z',
      lastSeenAt: '2026-11-10T06:30:00Z', device: 'Chrome on Android' };
    // An IP the service mistakenly adds is dropped before the answer leaves.
    expect(listMySessions.output.parse({ items: [{ ...item, ip: '203.0.113.7' }], next: null }))
      .toEqual({ items: [item], next: null });
  });
});
