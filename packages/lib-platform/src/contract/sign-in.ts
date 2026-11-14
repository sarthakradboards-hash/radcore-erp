// lib-platform's sign-in and own-account contracts (ADR-001 §6, §7a), re-exported by ../contract.ts. Like every
// contract file it imports only zod and lib-common (D5), so the browser can load it.
import {
  defineContract, emailString, idString, listInput, listOf, momentString, newPassword, passwordString,
} from '@radcore/lib-common';
import { z } from 'zod';

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

/** Signed in: ten new recovery codes for a current authenticator code, and the old set stops working (M1-15). It's
 * how someone whose enrolment answer was lost gets codes again. The answer holds the codes, so saved-once stores none
 * (storesAnswer: false) and a repeated key answers answer_not_kept. */
export const newRecoveryCodes = defineContract({
  method: 'POST', path: '/me/second-factor/recovery-codes', auth: 'session', perm: 'session:read', storesAnswer: false,
  tx: write, input: z.object({ code: totpCode() }), output: z.object({ recoveryCodes: z.array(z.string()).length(10) }),
  errors: ['second_factor_invalid', 'no_second_factor'],
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
