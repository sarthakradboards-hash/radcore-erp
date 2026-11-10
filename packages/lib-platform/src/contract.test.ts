// RAD-34's /me contract, declared ahead of the sessions service: its shape is what ui builds RAD-50, RAD-52 and
// RAD-55 against, and the same schema refuses a bad answer on both sides.
import { requestFor } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { getMe } from './contract.ts';

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
