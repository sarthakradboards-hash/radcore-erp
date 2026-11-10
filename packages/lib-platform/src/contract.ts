// lib-platform's route contracts (ADR-001 §6, §7a): declared once, shared by the API and the web app. Like every
// contract file it imports only zod and lib-common (D5), so the browser can load it.
import { defineContract, emailString, idString, listInput, listOf, momentString } from '@radcore/lib-common';
import { z } from 'zod';

/** Permission keys, sorted and without duplicates, so the client can compare two answers as they are. */
const permissionKeys = z.array(z.string()).refine((keys) => keys.every((k, i) => i === 0 || (keys[i - 1] ?? '') < k),
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
// rate_limited are platform codes carrying retryAfterSeconds. Accepting an invite, resetting a password and changing
// your own password wait for M1-14's minimum password length.
const write = { readOnly: false, isolation: 'read committed' } as const;
const read = { readOnly: true, isolation: 'read committed' } as const;
const totpCode = () => z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your app');

/** Step 1. Sets the session cookie on `done`; otherwise a short-lived, HttpOnly pending-sign-in cookie for step 2. */
export const signIn = defineContract({
  method: 'POST', path: '/sign-in', auth: 'public', rateLimit: 'sign-in', perm: null, idempotency: 'exempt',
  tx: write,
  input: z.object({ email: emailString(), password: z.string().min(1).max(256) }), // no length rule on sign-in
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
 * saved-once stores none (storeAnswer: false). The pending secret is kept through the secrets library. */
export const startSecondFactorEnrolment = defineContract({
  method: 'POST', path: '/sign-in/second-factor/enrolment', auth: 'public', rateLimit: 'sign-in', perm: null,
  storeAnswer: false, tx: write, input: z.object({}),
  output: z.object({ otpauthUri: z.string(), secret: z.string() }), // the QR (drawn client-side) and typed entry
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
  method: 'POST', path: '/sign-out', auth: 'session', perm: 'session:write', idempotency: 'exempt',
  tx: write, input: z.object({}), output: z.object({}),
});

/** The same answer, in the same time, for any address; the email is queued for the worker (ADR-001 §7a). */
export const requestPasswordReset = defineContract({
  method: 'POST', path: '/password-reset/request', auth: 'public', rateLimit: 'password-reset', perm: null,
  tx: write, input: z.object({ email: emailString() }), output: z.object({}),
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
  method: 'DELETE', path: '/me/sessions/:id', auth: 'session', perm: 'session:write', tx: write,
  input: z.object({ id: idString() }), output: z.object({}), errors: ['current_session'],
});

/** ADR-001 §7a's fixed lists, as "METHOD /path". The generic handler accepts `idempotency: 'exempt'` and
 * `storeAnswer: false` only from these routes, and the permission manifest test (M1-19) fails on any other. */
export const KEY_EXEMPT_ROUTES = ['POST /sign-in', 'POST /sign-out', 'POST /sign-in/second-factor',
  'POST /sign-in/second-factor/enrolment/confirm'] as const;
// shortcut: M1-15's signed-in "new recovery codes" route joins this list when it is declared.
export const ANSWER_NOT_STORED_ROUTES = ['POST /sign-in/second-factor/enrolment'] as const;
