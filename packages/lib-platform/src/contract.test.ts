// RAD-34's /me contract, declared ahead of the sessions service: its shape is what ui builds RAD-50, RAD-52 and
// RAD-55 against, and the same schema refuses a bad answer on both sides.
import { newPasswordFields, requestFor } from '@radcore/lib-common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './contract.ts';
import {
  acceptInvite, ANSWER_NOT_STORED_ROUTES, AUDIT_RANGE_MAX_DAYS, changePassword, confirmSecondFactorEnrolment, deactivateUser, endMySession,
  endSession, endUserSessions, getMe, getPermissionMatrix, inviteUser, KEY_EXEMPT_ROUTES, listAuditedTables,
  listAuditTrail, listMySessions, listRoles, listSecurityEvents, listSessions, listUsers, reactivateUser,
  removeSecondFactor, resetPassword, requestPasswordReset, SECURITY_EVENT_ROUTES, securityEvent, setRolePermissions, setUserRole, signIn,
  startSecondFactorEnrolment, verifySecondFactor, importFiles, photoFiles, resumeFiles, statementFiles,
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
  // A kind's file contracts come in a group (photoFiles.downloadLink and the rest), so groups are opened one level.
  const declared = Object.values(contracts).flatMap((c): unknown[] => typeof c === 'object' && !('path' in c) ? Object.values(c) : [c])
    .filter((c): c is typeof signIn => typeof c === 'object' && c !== null && 'path' in c);
  const route = (c: { method: string; path: string }) => `${c.method} ${c.path}`;

  it("lists exactly the routes that declare each saved-once flag (ADR-001 §7a's fixed lists)", () => {
    expect(declared.filter((c) => c.idempotency === 'exempt').map(route).sort()).toEqual([...KEY_EXEMPT_ROUTES].sort());
    expect(declared.filter((c) => c.storesAnswer === false).map(route).sort()).toEqual([...ANSWER_NOT_STORED_ROUTES].sort());
    expect(KEY_EXEMPT_ROUTES).toHaveLength(4);
  });

  it('puts every own-account route on the one key every role holds, session:read (RAD-32)', () => {
    expect(declared.filter((c) => c.auth === 'session' && !/^\/(admin|files)\//.test(c.path)).map((c) => [route(c), c.perm])).toEqual([
      ['GET /me', 'session:read'], ['POST /sign-out', 'session:read'], ['POST /me/password', 'session:read'],
      ['POST /me/second-factor/recovery-codes', 'session:read'], ['GET /me/sessions', 'session:read'],
      ['DELETE /me/sessions/:id', 'session:read']]);
  });

  it('marks exactly the three new-password fields for the check before the transaction (ADR-001 §7a)', () => {
    const marked = declared.flatMap((c) => (c.input instanceof z.ZodObject
      ? Object.entries(c.input.shape as Record<string, z.ZodType>).filter(([, s]) => newPasswordFields.has(s))
        .map(([field]) => `${route(c)} ${field}`)
      : []));
    expect(marked).toEqual(['POST /invites/accept password', 'POST /password-reset password', 'POST /me/password newPassword']);
  });

  it('sets a password from an invite or a reset with the token in the body, and changes one with the current one', () => {
    const token = 'k'.repeat(43);
    // The schema has only the cap: a short password reaches the check, which answers password_rejected (too_short).
    expect(acceptInvite.input.safeParse({ token, password: 'short' }).success).toBe(true);
    expect(resetPassword.input.safeParse({ token, password: 'x'.repeat(1025) }).success).toBe(false);
    expect(acceptInvite.input.safeParse({ token: 'too-short', password: 'a long enough passphrase' }).success).toBe(false);
    expect([acceptInvite, resetPassword].map((c) => c.errors)).toEqual([['link_expired', 'password_rejected'],
      ['link_expired', 'password_rejected']]);
    expect(changePassword.errors).toEqual(['invalid_credentials', 'password_rejected']);
    expect(changePassword.output.parse({ otherSessionsEnded: 2 })).toEqual({ otherSessionsEnded: 2 });
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
    expect(startSecondFactorEnrolment.storesAnswer).toBe(false);
    // Only the otpauth URI (ADR-001 §7a): a separate secret field is dropped, never sent twice.
    const uri = 'otpauth://totp/RadCore:asha%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=RadCore';
    expect(startSecondFactorEnrolment.output.parse({ otpauthUri: uri, secret: 'JBSWY3DPEHPK3PXP' })).toEqual({ otpauthUri: uri });
    expect(startSecondFactorEnrolment.output.safeParse({ otpauthUri: 'https://example.com' }).success).toBe(false);
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

// RAD-57's admin routes, declared ahead of their services (RAD-30, 31, 32, 34, 35, 36) to ui-2's shapes there.
describe('the admin contracts', () => {
  const admin = Object.values(contracts).filter((c): c is typeof listUsers =>
    typeof c === 'object' && 'path' in c && c.path.startsWith('/admin/'));
  const id = '3f2b8c9e-1d4a-4f6b-9c2e-7a1b5d3e9f01';
  const at = '2026-11-10T06:00:00Z';
  const okFor = (c: { input: z.ZodType }, input: unknown) => c.input.safeParse(input).success;

  it('are admin-only: a session, one of five admin keys, read-only GETs, and no saved-once exemption', () => {
    expect(admin).toHaveLength(16);
    for (const c of admin) {
      expect(c.auth).toBe('session');
      expect(['users:read', 'users:write', 'roles:read', 'roles:write', 'audit:read']).toContain(c.perm);
      expect(c.tx.readOnly).toBe(c.method === 'GET');
      expect(c.idempotency).toBeUndefined();
      expect(c.storesAnswer).toBeUndefined();
    }
  });

  it('take a typed reason for every change that removes access or power, and refuse a blank one', () => {
    for (const [c, rest] of [[setUserRole, { id, role: 'sales' }], [deactivateUser, { id }], [reactivateUser, { id }],
      [removeSecondFactor, { id }], [setRolePermissions, { key: 'sales', grants: ['sales:read'], version: '7' }]] as const) {
      expect(okFor(c, { ...rest, reason: 'Moved to the sales team' })).toBe(true);
      expect(okFor(c, { ...rest, reason: '   ' })).toBe(false);
      expect(okFor(c, { ...rest, reason: 'x'.repeat(501) })).toBe(false);
      expect(okFor(c, rest)).toBe(false);
    }
  });

  it('name the self-escalation refusals the screens word (M1-18)', () => {
    expect(inviteUser.errors).toEqual(['email_taken', 'role_not_grantable']);
    expect(setUserRole.errors).toEqual(['own_account', 'role_not_grantable', 'last_admin']);
    expect(deactivateUser.errors).toEqual(['own_account', 'last_admin', 'already_disabled', 'role_not_grantable']);
    expect(reactivateUser.errors).toEqual(['not_disabled', 'role_not_grantable']); // only an admin reactivates an admin
    expect(setRolePermissions.errors).toEqual(['role_not_editable', 'matrix_changed', 'unknown_permission', 'permission_not_held']);
    expect([endSession.errors, endUserSessions.errors]).toEqual([['current_session'], ['own_account']]);
  });

  it('sort people only by the declared columns', () => {
    const list = { filter: {}, limit: 50 };
    expect(okFor(listUsers, { ...list, sort: { column: 'lastSignInAt', desc: true } })).toBe(true);
    expect(okFor(listUsers, { ...list, sort: { column: 'role', desc: false } })).toBe(false);
    expect(okFor(listSessions, { ...list, sort: { column: 'lastSeenAt', desc: true } })).toBe(false);
  });

  it("flag the caller's own row and drop what isn't declared, such as a password hash or an IP", () => {
    const user = { id, displayName: 'Asha Rao', email: 'asha@example.com', status: 'active', role: 'admin',
      lastSignInAt: null, secondFactor: 'enrolled', self: true };
    expect(listUsers.output.safeParse({ items: [{ ...user, secondFactor: 'enrolment_required' }], next: null }).success).toBe(true);
    expect(listUsers.output.safeParse({ items: [{ ...user, secondFactor: 'not_enrolled' }], next: null }).success).toBe(false);
    expect(listUsers.output.parse({ items: [{ ...user, passwordHash: 'argon2-hash' }], next: null }))
      .toEqual({ items: [user], next: null });
    const session = { id, user: { id, displayName: 'Asha Rao' }, createdAt: at, lastSeenAt: at, idleExpiresAt: at,
      absoluteExpiresAt: at, device: 'Chrome on Android', current: false };
    expect(listSessions.output.parse({ items: [{ ...session, ip: '203.0.113.7' }], next: null }))
      .toEqual({ items: [session], next: null });
  });

  it("send a role's grants sorted and once each, with the version they were read at", () => {
    const save = { key: 'sales', version: '7', reason: 'Sales may raise quotes' };
    expect(okFor(setRolePermissions, { ...save, grants: ['parties:read', 'sales:write'] })).toBe(true);
    expect(okFor(setRolePermissions, { ...save, grants: ['sales:write', 'parties:read'] })).toBe(false);
    expect(okFor(setRolePermissions, { ...save, grants: ['sales:write', 'sales:write'] })).toBe(false);
    expect(okFor(setRolePermissions, { ...save, key: 'Sales!', grants: [] })).toBe(false);
    expect(okFor(setRolePermissions, { ...save, grants: ['everything'] })).toBe(false); // module:action only
    expect(okFor(setRolePermissions, { ...save, grants: Array.from({ length: 501 }, (_, i) => `m${String(i).padStart(3, '0')}:read`) }))
      .toBe(false);
  });

  it('read the audit trail and security events only within a stated date range', () => {
    const list = { limit: 50 };
    const occurred = { from: '2026-10-11', to: '2026-11-10' };
    expect(okFor(listAuditTrail, { ...list, filter: { occurred } })).toBe(true);
    expect(okFor(listAuditTrail, { ...list, filter: {} })).toBe(false);
    for (const c of [listAuditTrail, listSecurityEvents]) {
      expect(okFor(c, { ...list, filter: { occurred: {} } })).toBe(false); // both ends, always
      expect(okFor(c, { ...list, filter: { occurred: { from: '2026-10-11' } } })).toBe(false);
    }
    expect(AUDIT_RANGE_MAX_DAYS).toBe(92);
    // event_log.user_id is a uuid: a name there would be a 500, so the schema refuses it first.
    expect(okFor(listSecurityEvents, { ...list, filter: { occurred, principal: 'system:online-orders' } })).toBe(false);
    expect(okFor(listSecurityEvents, { ...list, filter: { occurred, principal: id } })).toBe(true);
    expect(okFor(listAuditTrail, { ...list, filter: { occurred: { from: '2026-11-10', to: '2026-10-11' } } })).toBe(false);
    expect(okFor(listAuditTrail, { ...list, filter: { occurred, tableName: 'users; drop' } })).toBe(false);
    expect(okFor(listSecurityEvents, { ...list, filter: { occurred, kind: 'sign_in_failed' } })).toBe(true);
    expect([listAuditTrail.errors, listSecurityEvents.errors]).toEqual([['range_too_long'], ['range_too_long']]);
  });

  it('carry audit values as stored, secrets and personal data as "[redacted]", and a failed sign-in with no principal', () => {
    const row = { id, occurredAt: at, principal: { kind: 'system', id: 'system:online-orders', displayName: null },
      tableName: 'users', recordId: id, op: 'update',
      changed: { status: { old: 'active', new: 'disabled' }, phone: { old: '[redacted]', new: '[redacted]' } } };
    expect(listAuditTrail.output.parse({ items: [row], next: null })).toEqual({ items: [row], next: null });
    const event = { id, occurredAt: at, kind: 'sign_in_failed', principal: null, device: 'Edge on Windows',
      detail: { reason: 'invalid_credentials' } };
    expect(listSecurityEvents.output.parse({ items: [event], next: null })).toEqual({ items: [event], next: null });
    expect(listSecurityEvents.output.safeParse({ items: [{ ...event, kind: 'password_seen' }], next: null }).success).toBe(false);
    // Each kind's detail is references only (RAD-31): the typed email never rides along.
    const leak = { ...event, detail: { reason: 'invalid_credentials', email: 'asha@example.com' } };
    expect(listSecurityEvents.output.safeParse({ items: [leak], next: null }).success).toBe(false);
    expect(securityEvent.safeParse({ kind: 'export', detail: { what: 'crm.parties', rows: 3 } }).success).toBe(true);
    expect(securityEvent.safeParse({ kind: 'export', detail: { what: 'Parties.csv', rows: 3 } }).success).toBe(false);
  });

  it("list the routes that record security events, each a declared contract (RC-031's register, RAD-31)", () => {
    // A kind's file contracts come in a group (photoFiles.downloadLink and the rest), so groups are opened one level.
    const routes = new Set(Object.values(contracts).flatMap((c): unknown[] => typeof c === 'object' && !('path' in c) ? Object.values(c) : [c])
      .filter((c): c is typeof signIn => typeof c === 'object' && c !== null && 'path' in c).map((c) => `${c.method} ${c.path}`));
    expect(Object.keys(SECURITY_EVENT_ROUTES).filter((r) => !routes.has(r))).toEqual([]);
    expect(SECURITY_EVENT_ROUTES).toEqual({
      'POST /sign-in': ['sign_in', 'sign_in_failed', 'session_ended'],
      'POST /sign-in/second-factor': ['sign_in', 'sign_in_failed', 'session_ended'],
      'POST /sign-in/second-factor/enrolment/confirm': ['second_factor_changed', 'sign_in', 'session_ended'],
      'POST /invites/accept': ['password_changed'],
      'POST /password-reset': ['password_changed', 'session_ended'],
      'POST /me/password': ['password_changed', 'session_ended'],
      'POST /sign-out': ['session_ended'],
      'DELETE /me/sessions/:id': ['session_ended'],
      'DELETE /admin/sessions/:id': ['session_ended'],
      'POST /admin/users/:id/sessions/end': ['session_ended'],
      'POST /me/second-factor/recovery-codes': ['second_factor_changed'],
      'POST /admin/users/:id/second-factor/remove': ['second_factor_changed', 'session_ended'],
      'POST /files/photo/:id/download': ['download'],
      'POST /files/resume/:id/download': ['download'],
      'POST /files/statement/:id/download': ['download'],
      'POST /files/import/:id/download': ['download'],
    });
  });

  it('put path parameters in the path', () => {
    expect(requestFor(setRolePermissions, { key: 'sales', grants: [], version: '7', reason: 'r' }).path)
      .toBe('/admin/roles/sales/permissions');
    expect(requestFor(endSession, { id })).toEqual({ method: 'DELETE', path: `/admin/sessions/${id}`, body: undefined });
    expect([listRoles, getPermissionMatrix, listAuditedTables].map((c) => requestFor(c, {}).path))
      .toEqual(['/admin/roles', '/admin/permissions', '/admin/audit/tables']);
  });
});

describe('the file contracts (RAD-43, RC-096)', () => {
  it.each([['photo', photoFiles], ['resume', resumeFiles], ['statement', statementFiles], ['import', importFiles]] as const)(
    'gives %s files their own read and write permissions', (kind, c) => {
      expect([c.startUpload, c.confirmUpload, c.downloadLink].map((x) => `${x.method} ${x.path} ${x.perm} ${String(x.tx.readOnly)}`)).toEqual([
        `POST /files/${kind} ${kind}_files:write false`,
        `POST /files/${kind}/:id/confirm ${kind}_files:write false`,
        `POST /files/${kind}/:id/download ${kind}_files:read false`,
      ]);
    });

  it("takes only its kind's types, and a file name without control characters", () => {
    const ok = (c: typeof photoFiles, body: object) => c.startUpload.input.safeParse(body).success;
    expect([
      ok(photoFiles, { filename: 'bill.heic', contentType: 'image/heic' }),
      ok(photoFiles, { filename: 'cv.pdf', contentType: 'application/pdf' }),
      ok(resumeFiles, { filename: 'cv.pdf', contentType: 'application/pdf' }),
      ok(resumeFiles, { filename: 'cv\r\n.pdf', contentType: 'application/pdf' }),
      ok(resumeFiles, { filename: '   ', contentType: 'application/pdf' }),
      ok(resumeFiles, { filename: 'a'.repeat(256), contentType: 'application/pdf' }),
    ]).toEqual([true, false, true, false, false, false]);
  });
});
