// lib-platform's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every
// contract file it imports only zod and lib-common (D5), so the browser can load it.
import {
  dateString, defineContract, emailString, idString, listInput, listOf, momentString, newPassword, passwordString,
  searchText, sortInput,
} from '@radcore/lib-common';
import { z } from 'zod';
import { FILE_KINDS, type FileKind } from './files/kinds.ts';

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
    secondFactor: z.enum(['not_required', 'enrolled', 'enrolment_required']), // D-19 (widened 10 Nov): admin, owner, accounts and HR
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
    z.object({ next: z.literal('second_factor') }), // D-19: a role that needs one, with a factor enrolled
    z.object({ next: z.literal('enrol_second_factor') }), // D-19: a role that needs one, without one yet
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
    lastSignInAt: momentString().nullable(), secondFactor: z.enum(['not_required', 'enrolled', 'enrolment_required']), // D-19, as getMe
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

/** Disabled: every session ends and open invite and reset links stop working. role_not_grantable: only an admin
 * deactivates an admin. */
export const deactivateUser = defineContract({
  method: 'POST', path: '/admin/users/:id/deactivate', auth: 'session', perm: 'users:write', tx: write,
  input: z.object({ id: idString(), reason: reason() }),
  output: z.object({ sessionsEnded: z.number().int().nonnegative() }),
  errors: ['own_account', 'last_admin', 'already_disabled', 'role_not_grantable'],
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

/** Replaces one role's grants. It applies at once in every process (RC-095) and is audited with its reason.
 * permission_not_held: nobody grants a key they don't hold themselves. */
export const setRolePermissions = defineContract({
  method: 'PUT', path: '/admin/roles/:key/permissions', auth: 'session', perm: 'roles:write', tx: write,
  input: z.object({ key: roleKey(), grants: permissionKeys, version: z.string(), reason: reason() }),
  output: z.object({ version: z.string() }),
  errors: ['role_not_editable', 'matrix_changed', 'unknown_permission', 'permission_not_held'],
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

/** The security events (RAD-31, RC-031). A new kind is a migration too: event_log's CHECK lists them. Kinds, and the
 * values of each detail's enums, are only ever added: the list parses every stored row with these schemas, so one
 * removed or renamed would fail the old pages that hold it (auditor-2 on #109). */
export const SECURITY_EVENT_KINDS = ['sign_in', 'sign_in_failed', 'password_changed', 'second_factor_changed', 'export',
  'download'] as const;
const securityEventKind = z.enum(SECURITY_EVENT_KINDS);
// Each kind's detail: references only, never a typed email, password, code or token (M6-16; the architect on RAD-31).
// Each detail is strict, so nothing else can ride along, on the way in (recordSecurityEvent) or out (the list).
const eventUnion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sign_in'), detail: z.strictObject({}) }),
  z.object({ kind: z.literal('sign_in_failed'), detail: z.strictObject({
    reason: z.enum(['invalid_credentials', 'second_factor', 'account_locked', 'rate_limited']) }) }),
  z.object({ kind: z.literal('password_changed'), detail: z.strictObject({ how: z.enum(['change', 'reset', 'invite']) }) }),
  z.object({ kind: z.literal('second_factor_changed'), detail: z.strictObject({
    change: z.enum(['enrolled', 'removed', 'recovery_codes']) }) }),
  z.object({ kind: z.literal('export'), detail: z.strictObject({
    what: z.string().regex(/^[a-z][a-z0-9_.-]{0,62}$/, 'A list name, such as sales.invoices'),
    rows: z.number().int().nonnegative() }) }),
  z.object({ kind: z.literal('download'), detail: z.strictObject({ fileId: idString() }) }),
]);
/** One security event as recorded: its kind and that kind's detail. Typed plainly, so lint's D7 walk stays small. */
export const securityEvent: z.ZodType<z.output<typeof eventUnion>, z.input<typeof eventUnion>> = eventUnion;

/**
 * The routes that record security events, and which (RC-031's register, RAD-31). Each route's own ticket proves in
 * its test that it writes them: RAD-32 sign-in and passwords, RAD-33 the second factor. Exports and downloads join
 * when they're declared (RAD-47 part 2, RAD-43 part 2).
 */
export const SECURITY_EVENT_ROUTES = {
  'POST /sign-in': ['sign_in', 'sign_in_failed'],
  'POST /sign-in/second-factor': ['sign_in', 'sign_in_failed'],
  'POST /sign-in/second-factor/enrolment/confirm': ['second_factor_changed', 'sign_in'],
  'POST /invites/accept': ['password_changed'],
  'POST /password-reset': ['password_changed'],
  'POST /me/password': ['password_changed'],
  'POST /files/photo/:id/download': ['download'],
  'POST /files/resume/:id/download': ['download'],
  'POST /files/statement/:id/download': ['download'],
  'POST /files/import/:id/download': ['download'],
} as const satisfies Record<string, readonly (typeof SECURITY_EVENT_KINDS)[number][]>;

/** Security events (RAD-31's event_log), newest first on (occurred_at desc, seq desc), the audit viewer's second tab.
 * `principal` is the account the event concerns; with none, the system principal that acted (a job's export);
 * otherwise null, such as a failed sign-in that matched nobody. */
export const listSecurityEvents = defineContract({
  method: 'GET', path: '/admin/security-events', auth: 'session', perm: 'audit:read', tx: read,
  input: listInput(z.object({ occurred: auditRange(), kind: securityEventKind.optional(), principal: idString().optional() })),
  output: listOf(z.object({
    id: idString(), occurredAt: momentString(), principal: principalOut.nullable(), device: z.string().max(80),
  }).and(securityEvent)),
  errors: ['range_too_long'],
});

/**
 * One kind of approval's three routes (maker-checker, RAD-38, ADR-001 §8b, RC-037), under one static permission: a
 * module's contract.ts declares `approvalContracts('purchase-order', 'purchasing:approve')`, and its route file spreads
 * `...defineApproval(contracts, spec)`.
 * - listPending: the oldest pending requests within the approver's scope.
 * - getApproval: one request with the record's version as it is now. `versionHash` is what was requested,
 *   `currentHash` what the record hashes to now, and `changed` says they differ (then it can only be rejected).
 * - decide: approve the version the screen showed (`versionHash`), or reject with a reason. Refused with
 *   `own_request`, `approver_too_new`, `version_changed` or `not_pending`.
 */
export const approvalContracts = <K extends string>(kind: K, perm: `${string}:${string}`) => {
  const request = z.object({
    id: idString(), recordId: idString(), status: z.enum(['pending', 'approved', 'rejected', 'superseded']),
    requestedBy: z.string(), requestedAt: momentString(),
    decidedBy: z.string().nullable(), decidedAt: momentString().nullable(), reason: z.string().nullable(),
  });
  const hash = () => z.string().regex(/^[0-9a-f]{64}$/, 'Not a version');
  return Object.freeze({
    listPending: defineContract({
      method: 'GET', path: `/approvals/${kind}`, auth: 'session', perm, tx: read,
      input: listInput(z.object({})),
      output: listOf(z.object({ id: idString(), recordId: idString(), requestedBy: z.string(), requestedAt: momentString() })),
    }),
    getApproval: defineContract({
      method: 'GET', path: `/approvals/${kind}/:id`, auth: 'session', perm, tx: read,
      input: z.object({ id: idString() }),
      output: request.extend({ version: z.json(), versionHash: hash(), currentHash: hash(), changed: z.boolean() }),
    }),
    decide: defineContract({
      method: 'POST', path: `/approvals/${kind}/:id/decision`, auth: 'session', perm, tx: write,
      input: z.object({ id: idString(), decision: z.enum(['approve', 'reject']), versionHash: hash().optional(),
        reason: z.string().trim().min(1, 'Say why, in your own words').max(500).optional() })
        .refine((d) => d.decision === 'reject' || d.versionHash !== undefined, { path: ['versionHash'], error: 'Approve the version you saw' })
        .refine((d) => d.decision === 'approve' || d.reason !== undefined, { path: ['reason'], error: 'Say why, in your own words' }),
      output: z.object({ status: z.enum(['approved', 'rejected']) }),
      errors: ['own_request', 'approver_too_new', 'version_changed', 'not_pending'],
    }),
  });
};

 * A kind of uploaded file's three routes (RAD-43, RC-096): each kind has its own `<kind>_files:read` and `:write`, so a
 * role that may attach bill photos can't open statements. The browser uploads straight to S3 (RC-191):
 * 1. startUpload: a 5-minute presigned POST for one file of an allowed type, and the file's id (status `pending`);
 * 2. the browser POSTs the file to `url` with `fields`;
 * 3. confirmUpload: the file is `checking` while a job checks its size, type and first bytes in S3;
 * 4. downloadLink: a 60-second link, for a `ready` file only, recorded as a `download` security event. A file still checking answers `not_ready`; one the
 *    check refused answers `upload_refused`.
 * Every answer is `Cache-Control: no-store` (the handler's), and so is the download itself (the link's).
 */
const fileContracts = <K extends FileKind>(kind: K) => {
  const types = [...FILE_KINDS[kind].types] as [string, ...string[]];
  const params = z.object({ id: idString() });
  return Object.freeze({
    startUpload: defineContract({
      method: 'POST', path: `/files/${kind}`, auth: 'session', perm: `${kind}_files:write`, tx: write,
      input: z.object({
        // The name it's shown and downloaded under; never a path or a key.
        filename: z.string().trim().min(1, 'Name the file').max(255).regex(/^[^\p{Cc}]+$/u, 'Not a file name'),
        contentType: z.enum(types, { error: 'This kind of file isn\'t accepted here' }),
      }),
      output: z.object({ id: idString(), url: z.url(), fields: z.record(z.string(), z.string()) }),
    }),
    confirmUpload: defineContract({
      method: 'POST', path: `/files/${kind}/:id/confirm`, auth: 'session', perm: `${kind}_files:write`, tx: write,
      input: params, output: z.object({ status: z.literal('checking') }), errors: ['not_pending'],
    }),
    // A POST in a write transaction: each link records a `download` security event (RC-031), which a read-only
    // transaction can't write. The browser sends a new Idempotency-Key per click.
    downloadLink: defineContract({
      method: 'POST', path: `/files/${kind}/:id/download`, auth: 'session', perm: `${kind}_files:read`, tx: write,
      // The answer is a live presigned link: saved-once keeps the key but never the link (RC-132), so a repeated key
      // answers answer_not_kept and the browser asks again with a new one.
      storesAnswer: false,
      input: params, output: z.object({ url: z.url() }), errors: ['not_ready', 'upload_refused'],
    }),
  });
};
export const photoFiles = fileContracts('photo');
export const resumeFiles = fileContracts('resume');
export const statementFiles = fileContracts('statement');
export const importFiles = fileContracts('import');

/** ADR-001 §7a's fixed lists, as "METHOD /path". The generic handler accepts `idempotency: 'exempt'` and
 * `storesAnswer: false` only from these routes, and the permission manifest test (M1-19) fails on any other. */
export const KEY_EXEMPT_ROUTES = ['POST /sign-in', 'POST /sign-out', 'POST /sign-in/second-factor',
  'POST /sign-in/second-factor/enrolment/confirm'] as const;
// shortcut: M1-15's signed-in "new recovery codes" route joins this list when it is declared.
export const ANSWER_NOT_STORED_ROUTES = ['POST /sign-in/second-factor/enrolment', 'POST /files/photo/:id/download',
  'POST /files/resume/:id/download', 'POST /files/statement/:id/download', 'POST /files/import/:id/download'] as const;
