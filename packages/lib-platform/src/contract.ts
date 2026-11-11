// lib-platform's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every
// contract file it imports only zod and lib-common (D5), so the browser can load it.
import {
  dateString, defineContract, emailString, idString, listInput, listOf, momentString, newPassword, passwordString,
  searchText, sortInput,
} from '@radcore/lib-common';
import { z } from 'zod';

/** Permission keys, sorted and without duplicates, so the client can compare two answers as they are. */
const permissionKeys = z.array(z.string().regex(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/, 'Not a permission key')).max(500).refine((keys) => keys.every((k, i) => i === 0 || (keys[i - 1] ?? '') < k),
  { error: 'Permission keys are sorted and appear once each' });

/**
 * GET /me (RAD-34, for RAD-50's shell, RAD-52's per-minute refresh and RAD-55's signed-out dialog): who is signed
 * in, what they may do now, and when their session ends. No session answers 401 `signed_out`; it never redirects.
 * No roles, email or phone: permissions are enough, and every screen fetches this.
 */
export const getMe = defineContract({
  method: 'GET', path: '/me', auth: 'session',
  perm: 'session:read', // held by every role: any signed-in person may read their own session
  tx: { readOnly: true, isolation: 'read committed' },
  input: z.object({}),
  output: z.object({
    user: z.object({ id: idString(), displayName: z.string() }),
    permissions: permissionKeys, // the person's keys now, such as "sales:write"
    session: z.object({
      idleExpiresAt: momentString(), // moves forward on activity
      absoluteExpiresAt: momentString(), // never moves
    }),
    secondFactor: z.enum(['not_required', 'enrolled', 'enrolment_required']), // D-19: admin and owner only
  }),
});

// Sign-in, the second factor, password reset and your own sessions (RAD-32, RAD-33, RAD-34), declared ahead of their
// services for RAD-55's screens, to ui's shapes on RAD-32. Built to ADR-001 §7a: an unknown and a known email get
// the same answer; invite and reset tokens travel in the body, never a path or query; account_locked and
// rate_limited are platform codes carrying retryAfterSeconds. A new password is marked newPassword(): the handler
// checks it (15 characters, the bundled list, Pwned Passwords) before the transaction, and a refusal is
// password_rejected with too_short, breached or same_as_old on the field. Your own account uses session:read.
const write = { readOnly: false, isolation: 'read committed' } as const;
const read = { readOnly: true, isolation: 'read committed' } as const;
const totpCode = () => z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your app');

/** Step 1. Sets the session cookie on `done`; otherwise a short-lived, HttpOnly pending-sign-in cookie for step 2. */
export const signIn = defineContract({
  method: 'POST', path: '/sign-in', auth: 'public', rateLimit: 'sign-in', perm: null, idempotency: 'exempt',
  tx: write,
  input: z.object({ email: emailString(), password: passwordString() }), // no length rule on sign-in
  output: z.discriminatedUnion('next', [
    z.object({ next: z.literal('done') }),
    z.object({ next: z.literal('second_factor') }), // D-19: admin or owner with a factor enrolled
    z.object({ next: z.literal('enrol_second_factor') }), // D-19: admin or owner without one yet
  ]),
  errors: ['invalid_credentials'], // the same answer for an unknown email and a wrong password
});

/** Step 2: a TOTP code or a recovery code (RAD-64). Sets the session cookie. */
export const verifySecondFactor = defineContract({
  method: 'POST', path: '/sign-in/second-factor', auth: 'public', rateLimit: 'sign-in', perm: null,
  idempotency: 'exempt', tx: write,
  input: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('totp'), code: totpCode() }),
    z.object({ kind: z.literal('recovery'), code: z.string().min(8).max(32) }),
  ]),
  output: z.object({}),
  errors: ['second_factor_invalid', 'sign_in_expired'], // sign_in_expired: the pending cookie is gone, so start again
});

/** Enrolment during sign-in, when step 1 answered enrol_second_factor. Its answer holds the new secret, so
 * saved-once stores none (storesAnswer: false). The pending secret is kept through the secrets library. */
export const startSecondFactorEnrolment = defineContract({
  method: 'POST', path: '/sign-in/second-factor/enrolment', auth: 'public', rateLimit: 'sign-in', perm: null,
  storesAnswer: false, tx: write, input: z.object({}),
  // Only the otpauth URI (ADR-001 §7a, RAD-61): the screen draws the QR from it and reads the secret out of it for
  // typed entry, so the secret isn't sent a second time.
  output: z.object({ otpauthUri: z.string().startsWith('otpauth://totp/') }),
  errors: ['sign_in_expired'],
});

/** Confirming with the new factor's first code finishes signing in and sets the session cookie, so it is exempt
 * (ADR-001 §7a). The recovery codes are shown once; a second confirm finds no pending enrolment and is refused. */
export const confirmSecondFactorEnrolment = defineContract({
  method: 'POST', path: '/sign-in/second-factor/enrolment/confirm', auth: 'public', rateLimit: 'sign-in', perm: null,
  idempotency: 'exempt', tx: write, input: z.object({ code: totpCode() }),
  output: z.object({ recoveryCodes: z.array(z.string()).length(10) }),
  errors: ['second_factor_invalid', 'sign_in_expired'],
});

/** Clears the session cookie. */
export const signOut = defineContract({
  method: 'POST', path: '/sign-out', auth: 'session', perm: 'session:read', idempotency: 'exempt',
  tx: write, input: z.object({}), output: z.object({}),
});

/** The same answer, in the same time, for any address; the email is queued for the worker (ADR-001 §7a). */
export const requestPasswordReset = defineContract({
  method: 'POST', path: '/password-reset/request', auth: 'public', rateLimit: 'password-reset', perm: null,
  tx: write, input: z.object({ email: emailString() }), output: z.object({}),
});

const linkToken = () => z.string().min(16).max(512); // from the link's #fragment, sent in the body (RAD-61)

/** Sets your password from an invite link. Starts no session: you sign in after (RAD-64). link_expired covers an
 * unknown, used or expired token with one answer. */
export const acceptInvite = defineContract({
  method: 'POST', path: '/invites/accept', auth: 'public', rateLimit: 'token-link', perm: null,
  tx: write, input: z.object({ token: linkToken(), password: newPassword() }), output: z.object({}),
  errors: ['link_expired', 'password_rejected'],
});

/** Sets a new password from a reset link. Starts no session, ends your other sessions and clears a lock. */
export const resetPassword = defineContract({
  method: 'POST', path: '/password-reset', auth: 'public', rateLimit: 'token-link', perm: null,
  tx: write, input: z.object({ token: linkToken(), password: newPassword() }), output: z.object({}),
  errors: ['link_expired', 'password_rejected'],
});

/** Signed in: change your own password. Ends your other sessions and keeps this one (M1-16). */
export const changePassword = defineContract({
  method: 'POST', path: '/me/password', auth: 'session', perm: 'session:read',
  tx: write, input: z.object({ currentPassword: passwordString(), newPassword: newPassword() }),
  output: z.object({ otherSessionsEnded: z.number().int().nonnegative() }),
  errors: ['invalid_credentials', 'password_rejected'],
});

/** Your own sessions. Ending another person's belongs to admin (RAD-57). */
export const listMySessions = defineContract({
  method: 'GET', path: '/me/sessions', auth: 'session', perm: 'session:read', tx: read,
  input: listInput(z.object({})),
  output: listOf(z.object({
    id: idString(), current: z.boolean(), createdAt: momentString(), lastSeenAt: momentString(),
    device: z.string().max(80), // a short user-agent summary ("Chrome on Android"); no IP
  })),
});

/** Another person's id answers not_found. The current session answers current_session: that's sign-out, which
 * clears the cookie. */
export const endMySession = defineContract({
  method: 'DELETE', path: '/me/sessions/:id', auth: 'session', perm: 'session:read', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['current_session'],
});

// The admin routes (RAD-57's screens), declared ahead of their services, to ui-2's shapes on RAD-32, RAD-34,
// RAD-36, RAD-30 and RAD-31. Admin only: users:*, roles:* and audit:read. The server decides every
// self-escalation rule (M1-18) and says so in flags (`self`, `grantable`, `editable`) and named refusals; the
// screens only show them. Every change that removes access or power takes a typed reason, kept in its audit row.
const roleKey = () => z.string().regex(/^[a-z][a-z_]{1,31}$/, 'Not a role');
const reason = () => z.string().trim().min(1, 'Say why, in your own words').max(500);
const userStatus = z.enum(['invited', 'active', 'disabled']); // the users table's own check
const principalOut = z.object({ kind: z.enum(['user', 'system', 'link']), id: z.string(), displayName: z.string().nullable() });

/** People, any status. `self` marks the caller's own row: no role change or deactivate there. */
export const listUsers = defineContract({
  method: 'GET', path: '/admin/users', auth: 'session', perm: 'users:read', tx: read,
  input: listInput(z.object({ search: searchText().optional(), status: userStatus.optional(), role: roleKey().optional() }),
    sortInput(['displayName', 'email', 'lastSignInAt'])),
  output: listOf(z.object({
    id: idString(), displayName: z.string(), email: z.string(), status: userStatus, role: roleKey(),
    lastSignInAt: momentString().nullable(), secondFactor: z.enum(['not_required', 'enrolled', 'not_enrolled']), // D-19
    self: z.boolean(),
  })),
});

/** Sends an invite link (the worker emails it); the person sets their own password (M1-14). The answer holds no
 * token or link. role_not_grantable: only admin grants admin (M1-18). */
export const inviteUser = defineContract({
  method: 'POST', path: '/admin/users', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ email: emailString(), displayName: z.string().trim().min(1, 'Enter a name').max(120), role: roleKey() }),
  output: z.object({ id: idString() }), errors: ['email_taken', 'role_not_grantable'],
});

/** A new link for an invited person; the old one stops working. */
export const resendInvite = defineContract({
  method: 'POST', path: '/admin/users/:id/invite', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['not_invited'],
});

/** Ends that person's sessions (M1-16). Nobody changes their own role (M1-18). */
export const setUserRole = defineContract({
  method: 'PUT', path: '/admin/users/:id/role', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString(), role: roleKey(), reason: reason() }),
  output: z.object({ sessionsEnded: z.number().int().nonnegative() }),
  errors: ['own_account', 'role_not_grantable', 'last_admin'],
});

/** Disabled: every session ends and open invite and reset links stop working. */
export const deactivateUser = defineContract({
  method: 'POST', path: '/admin/users/:id/deactivate', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString(), reason: reason() }),
  output: z.object({ sessionsEnded: z.number().int().nonnegative() }),
  errors: ['own_account', 'last_admin', 'already_disabled'],
});

/** Back to active, or to invited if no password was ever set. role_not_grantable: only an admin reactivates an
 * admin (RC-033). */
export const reactivateUser = defineContract({
  method: 'POST', path: '/admin/users/:id/reactivate', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString(), reason: reason() }), output: z.object({ status: userStatus }),
  errors: ['not_disabled', 'role_not_grantable'],
});

/** The roles, unpaged. `grantable`: may the caller give this role to someone. */
export const listRoles = defineContract({
  method: 'GET', path: '/admin/roles', auth: 'session', perm: 'roles:read', tx: read, input: z.object({}),
  output: z.object({ roles: z.array(z.object({
    key: roleKey(), name: z.string(), description: z.string(), userCount: z.number().int().nonnegative(),
    secondFactorRequired: z.boolean(), grantable: z.boolean(),
  })) }),
});

/** The whole matrix. A role is `editable: false` when it is admin (it holds every permission) or the caller's own
 * role; `version` changes on every matrix write, so two admins can't overwrite each other. */
export const getPermissionMatrix = defineContract({
  method: 'GET', path: '/admin/permissions', auth: 'session', perm: 'roles:read', tx: read, input: z.object({}),
  output: z.object({
    version: z.string(),
    permissions: z.array(z.object({ key: z.string(), module: z.string(), label: z.string() })),
    roles: z.array(z.object({ key: roleKey(), name: z.string(), editable: z.boolean(), grants: permissionKeys })),
  }),
});

/** Replaces one role's grants. It applies at once in every process (RC-095) and is audited with its reason. */
export const setRolePermissions = defineContract({
  method: 'PUT', path: '/admin/roles/:key/permissions', auth: 'session', perm: 'roles:write', tx: write,
  input: z.object({ key: roleKey(), grants: permissionKeys, version: z.string(), reason: reason() }),
  output: z.object({ version: z.string() }), errors: ['role_not_editable', 'matrix_changed', 'unknown_permission'],
});

/** Every live session, or one person's, newest activity first. No IP, as on listMySessions. */
export const listSessions = defineContract({
  method: 'GET', path: '/admin/sessions', auth: 'session', perm: 'users:read', tx: read,
  input: listInput(z.object({ userId: idString().optional() })),
  output: listOf(z.object({
    id: idString(), user: z.object({ id: idString(), displayName: z.string() }),
    createdAt: momentString(), lastSeenAt: momentString(), idleExpiresAt: momentString(), absoluteExpiresAt: momentString(),
    device: z.string().max(80), current: z.boolean(),
  })),
});

/** Ends anyone's session (M1-16). Your own current one answers current_session: that's sign-out. */
export const endSession = defineContract({
  method: 'DELETE', path: '/admin/sessions/:id', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['current_session'],
});

/** "Sign out everywhere" for one person, such as after a lost phone. Not your own account: use your sessions page. */
export const endUserSessions = defineContract({
  method: 'POST', path: '/admin/users/:id/sessions/end', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({ ended: z.number().int().nonnegative() }), errors: ['own_account'],
});

const auditOp = z.enum(['insert', 'update', 'delete']);
/** The widest range one audit or security-event read may ask for, both ends counted; past it, range_too_long. */
export const AUDIT_RANGE_MAX_DAYS = 92;
// Both ends required (unlike lib-common's dateRange), so a read always prunes to the months it names.
const auditRange = () => z.object({ from: dateString(), to: dateString() })
  .refine((r) => r.from <= r.to, { error: 'The start date is after the end date', path: ['to'] });
/** The audit trail (RAD-30 part 2), newest first, keyset on (occurred_at desc, seq desc): one save's rows share
 * occurred_at, and seq keeps them in the order written. Secret and personal-data columns are stored, and so arrive,
 * as "[redacted]" (the architect on RAD-30: references, not copies), so the screen never sees a raw personal value. */
export const listAuditTrail = defineContract({
  method: 'GET', path: '/admin/audit', auth: 'session', perm: 'audit:read', tx: read,
  input: listInput(z.object({
    occurred: auditRange(),
    tableName: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'Choose a table from the list').optional(),
    recordId: z.string().max(64).optional(),
    principal: z.string().max(80).optional(), // a user id, "system:<name>" or a link id (ADR-001 §6a)
    op: auditOp.optional(),
  })),
  output: listOf(z.object({
    id: idString(), occurredAt: momentString(), principal: principalOut,
    tableName: z.string(), recordId: z.string(), op: auditOp,
    // insert: new only; update: old and new for each changed column; delete: old only
    changed: z.record(z.string(), z.object({ old: z.json().optional(), new: z.json().optional() })),
  })),
  errors: ['range_too_long'],
});

/** The audited tables, for the viewer's filter. */
export const listAuditedTables = defineContract({
  method: 'GET', path: '/admin/audit/tables', auth: 'session', perm: 'audit:read', tx: read,
  input: z.object({}), output: z.object({ tables: z.array(z.string()) }),
});

const securityEventKind = z.enum(['sign_in', 'sign_in_failed', 'password_changed', 'second_factor_changed', 'export', 'download']);
/** Security events (RAD-31's event_log), newest first on (occurred_at desc, seq desc), the audit viewer's second tab.
 * `principal` is the account the event concerns; with none, the system principal that acted (a job's export);
 * otherwise null, such as a failed sign-in that matched nobody. `detail` never holds a password, code or token. */
export const listSecurityEvents = defineContract({
  method: 'GET', path: '/admin/security-events', auth: 'session', perm: 'audit:read', tx: read,
  input: listInput(z.object({ occurred: auditRange(), kind: securityEventKind.optional(), principal: idString().optional() })),
  output: listOf(z.object({
    id: idString(), occurredAt: momentString(), kind: securityEventKind, principal: principalOut.nullable(),
    device: z.string().max(80), detail: z.record(z.string(), z.json()),
  })),
  errors: ['range_too_long'],
});

/** ADR-001 §7a's fixed lists, as "METHOD /path". The generic handler accepts `idempotency: 'exempt'` and
 * `storesAnswer: false` only from these routes, and the permission manifest test (M1-19) fails on any other. */
export const KEY_EXEMPT_ROUTES = ['POST /sign-in', 'POST /sign-out', 'POST /sign-in/second-factor',
  'POST /sign-in/second-factor/enrolment/confirm'] as const;
// shortcut: M1-15's signed-in "new recovery codes" route joins this list when it is declared.
export const ANSWER_NOT_STORED_ROUTES = ['POST /sign-in/second-factor/enrolment'] as const;
