// The second sign-in factor (M1-15, RAD-33, D-19, ADR-001 §7a, ADR-003): a TOTP authenticator and ten single-use
// recovery codes.
// - After the password, a person who has a factor, or whose role needs one, gets a five-minute pending sign-in, not a
//   session (sessions.ts). The verify step takes a TOTP code or a recovery code and starts the session.
// - Someone who needs a factor but has none enrols during sign-in: start answers the otpauth URI; confirm takes the
//   first code, signs them in and answers the recovery codes, which are shown once.
// - Signed in, a person makes new recovery codes with a current code. An admin removes someone's factor after a lost
//   phone, and they enrol again at the next sign-in.
// - TOTP is SHA-1, 6 digits, 30-second steps, ±1 step, with a 20-byte secret. The last accepted step is stored, so a
//   code works once. Attempts are limited per account. Recovery codes are stored as Argon2id hashes.
// - The secret is kept by the secrets library, a KMS call in staging and production, so each route's `before` step
//   (ADR-001 §8) seals or opens it outside any transaction. The service then locks the row and refuses with
//   `conflict` if its ciphertext changed in between, such as a re-enrolment. The plaintext lives only in this request.
// - Enrolment, removal and new codes are security events, holding references only, never the secret or a code.
import { randomInt, randomUUID } from 'node:crypto';
import { platformTx, recoveryCodes, secondFactors, users } from '@radcore/db/platform';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import type { z } from 'zod';
import type {
  confirmSecondFactorEnrolment, newRecoveryCodes, removeSecondFactor, startSecondFactorEnrolment, verifySecondFactor,
} from '../contract.ts';
import type { Ctx } from '../ctx.ts';
import type { Limiter } from '../db/client.ts';
import { AppError, RecordedRefusal } from '../errors.ts';
import type { BeforeDeps } from '../route.ts';
import type { Secrets } from '../secrets.ts';
import { recordSecurityEvent } from '../security-events.ts';
import type { Passwords } from './passwords.ts';
import { cookieOf, finishPendingSignIn, pendingSignIn } from './sessions.ts';

/** Five tries per account in 15 minutes, then 15 minutes' wait: a 6-digit code can't be guessed in reach of it. */
export const SECOND_FACTOR_ATTEMPTS = Object.freeze({ points: 5, windowSeconds: 900, blockSeconds: 900 });
const RECOVERY_CODES = 10;
const TOTP_OPTIONS = { issuer: 'RadCore', algorithm: 'SHA1', digits: 6, period: 30 } as const;
const STEP_MS = TOTP_OPTIONS.period * 1000;
// 31 letters and digits, none easily misread (no 0/o, 1/l/i); 12 of them are about 59 random bits.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Where an authenticator secret is kept: the secrets library, bound to its second_factors row. */
export function factorSecrets(secrets: Secrets) {
  const place = (rowId: string) => ({ table: 'second_factors', column: 'secret', rowId });
  return Object.freeze({
    seal: async (secret: string, rowId: string) => ({ ciphertext: await secrets.encrypt(secret, place(rowId)), keyId: secrets.keyId }),
    open: (ciphertext: string, rowId: string) => secrets.decrypt(ciphertext, place(rowId)),
  });
}

/** The 30-second step a code matches, within one step either side of `now`, or null. */
function matchingStep(secret: string, code: string, now: Date): number | null {
  const delta = new TOTP({ ...TOTP_OPTIONS, secret: Secret.fromBase32(secret) }).validate({ token: code, timestamp: now.getTime(), window: 1 });
  return delta === null ? null : Math.floor(now.getTime() / STEP_MS) + delta;
}

const newCode = () => Array.from({ length: 3 }, () => Array.from({ length: 4 },
  () => ALPHABET[randomInt(ALPHABET.length)] ?? '').join('')).join('-');
// As typed: any case, with or without its dashes and spaces.
const plain = (code: string) => code.toLowerCase().replace(/[\s-]/g, '');

type In<C extends { input: z.ZodType }> = z.output<C['input']>;
type Out<C extends { output: z.ZodType }> = z.input<C['output']>;
/** What a `before` step opened: the factor's row, the ciphertext it read, and the secret, or null for no factor. */
type Opened = { factorId: string; ciphertext: string; secret: string } | null;
/** What enrolment's `before` step sealed: the new row's id, the secret, and its ciphertext. */
type Sealed = { id: string; secret: string; ciphertext: string; keyId: string };
type Deps = { passwords: Passwords; attempts: Limiter; now?: () => Date };

const invalid = () => new AppError('second_factor_invalid', 'That code didn’t work. Check it and try again');
const locked = (wait: number) => new AppError('account_locked', 'Too many tries. Please wait, then try again', [], wait);
const signedInUser = (ctx: Ctx): string => {
  if (ctx.principal.kind !== 'user') throw new AppError('signed_out', 'Please sign in');
  return ctx.principal.userId;
};

/** A `before` step: whose factor (the pending sign-in's, or the signed-in person's), read with no lock, then opened
 * outside the transaction. A locked account isn't opened: the service refuses it anyway, so a guess past the lock
 * costs no KMS call (the auditor on #132). */
async function openFactor(deps: BeforeDeps, attempts: Limiter, whose: 'pending' | 'signed_in', confirmed: boolean):
  Promise<Opened> {
  const found = await deps.read(async (ctx) => {
    const userId = whose === 'pending' ? (await pendingSignIn(ctx, cookieOf(ctx), { lock: false })).userId : signedInUser(ctx);
    const [row] = await platformTx(ctx).select({ id: secondFactors.id, secret: secondFactors.secret }).from(secondFactors)
      .where(and(eq(secondFactors.userId, userId), confirmed ? isNotNull(secondFactors.confirmedAt) : isNull(secondFactors.confirmedAt)))
      .limit(1);
    return row === undefined ? undefined : { ...row, userId };
  });
  if (found === undefined || (await attempts.wait(found.userId)) > 0) return null;
  return { factorId: found.id, ciphertext: found.secret, secret: await factorSecrets(deps.secrets).open(found.secret, found.id) };
}

export function createSecondFactor({ passwords, attempts, now = () => new Date() }: Deps) {
  /** A current TOTP code for the factor `before` opened, never one already used. The row is locked, and must still
   * hold the ciphertext `before` read. */
  async function acceptCode(ctx: Ctx, opened: Opened, code: string): Promise<boolean> {
    if (opened === null) return false;
    const tx = platformTx(ctx);
    const [factor] = await tx.select({ secret: secondFactors.secret, lastStep: secondFactors.lastStep, confirmedAt: secondFactors.confirmedAt })
      .from(secondFactors).where(eq(secondFactors.id, opened.factorId)).limit(1).for('update');
    if (factor?.secret !== opened.ciphertext) {
      throw new AppError('conflict', 'Your authenticator was changed while you were signing in. Please try again');
    }
    const step = matchingStep(opened.secret, code, now());
    if (step === null || (factor.lastStep !== null && step <= factor.lastStep)) return false;
    await tx.update(secondFactors).set({ lastStep: step, ...(factor.confirmedAt === null ? { confirmedAt: now() } : {}) })
      .where(eq(secondFactors.id, opened.factorId));
    return true;
  }

  /** A fresh set of recovery codes; the old set stops working. Answers the codes, shown to the person once. */
  async function replaceCodes(ctx: Ctx, userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODES }, newCode);
    const hashes = await Promise.all(codes.map(async (c) => passwords.hash(plain(c))));
    const tx = platformTx(ctx);
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(hashes.map((codeHash) => ({ userId, codeHash })));
    return codes;
  }

  /** Spends one unused recovery code that matches, if any. */
  async function useRecoveryCode(ctx: Ctx, userId: string, code: string): Promise<boolean> {
    const tx = platformTx(ctx);
    const unused = await tx.select({ id: recoveryCodes.id, codeHash: recoveryCodes.codeHash }).from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt))).for('update');
    for (const row of unused) {
      if ((await passwords.verify(row.codeHash, plain(code))).ok) {
        await tx.update(recoveryCodes).set({ usedAt: now() }).where(eq(recoveryCodes.id, row.id));
        return true;
      }
    }
    return false;
  }

  /** Counts a try against the account; a locked one is refused with when to retry. */
  const tryCount = async (userId: string): Promise<void> => {
    const wait = await attempts.hit(userId);
    if (wait > 0) throw locked(wait);
  };

  return Object.freeze({
    /** POST /sign-in/second-factor's `before`: a TOTP code needs the secret; a recovery code doesn't. */
    openForVerify: async (input: In<typeof verifySecondFactor>, deps: BeforeDeps): Promise<Opened> =>
      (input.kind === 'totp' ? openFactor(deps, attempts, 'pending', true) : null),

    /** POST /sign-in/second-factor: a TOTP code or a recovery code finishes the pending sign-in. A refusal is recorded,
     * and that record commits though the answer is a refusal. */
    async verify(ctx: Ctx, input: In<typeof verifySecondFactor>, { before }: { before: Opened }): Promise<Out<typeof verifySecondFactor>> {
      const cookie = cookieOf(ctx);
      const pending = await pendingSignIn(ctx, cookie);
      const refuse = async (err: AppError, reason: 'second_factor' | 'account_locked') => {
        await recordSecurityEvent(ctx, { kind: 'sign_in_failed', detail: { reason } }, { userId: pending.userId, device: cookie.device });
        return new RecordedRefusal(err.code, err.message, err.issues, err.retryAfterSeconds);
      };
      const wait = await attempts.hit(pending.userId);
      if (wait > 0) throw await refuse(locked(wait), 'account_locked');
      const ok = input.kind === 'totp' ? await acceptCode(ctx, before, input.code) : await useRecoveryCode(ctx, pending.userId, input.code);
      if (!ok) throw await refuse(invalid(), 'second_factor');
      await attempts.reset(pending.userId);
      await finishPendingSignIn(ctx, cookie, pending);
      return {};
    },

    /** POST /sign-in/second-factor/enrolment's `before`: for a live pending sign-in only, a new row id and secret,
     * sealed for that row. */
    async sealForEnrolment(_input: In<typeof startSecondFactorEnrolment>, deps: BeforeDeps): Promise<Sealed> {
      await deps.read(async (ctx) => pendingSignIn(ctx, cookieOf(ctx), { lock: false }));
      const id = randomUUID();
      const secret = new Secret({ size: 20 }).base32;
      return { id, secret, ...(await factorSecrets(deps.secrets).seal(secret, id)) };
    },

    /** POST /sign-in/second-factor/enrolment: the new secret, for someone with no factor yet, replacing an unconfirmed
     * one. The answer is its otpauth URI, which the screen draws as a QR code. */
    async startEnrolment(ctx: Ctx, _input: In<typeof startSecondFactorEnrolment>, { before }: { before: Sealed }):
      Promise<Out<typeof startSecondFactorEnrolment>> {
      const pending = await pendingSignIn(ctx, cookieOf(ctx));
      const tx = platformTx(ctx);
      const [person] = await tx.select({ email: users.email, factor: secondFactors.confirmedAt }).from(users)
        .leftJoin(secondFactors, eq(secondFactors.userId, users.id)).where(eq(users.id, pending.userId)).limit(1);
      // Someone with a factor gives it at the verify step; this pending sign-in isn't for enrolling.
      if (person === undefined || person.factor !== null) throw new AppError('sign_in_expired', 'Please sign in again');
      await tx.delete(secondFactors).where(and(eq(secondFactors.userId, pending.userId), isNull(secondFactors.confirmedAt)));
      await tx.insert(secondFactors).values({ id: before.id, userId: pending.userId, secret: before.ciphertext, secretKeyId: before.keyId });
      return { otpauthUri: new TOTP({ ...TOTP_OPTIONS, label: person.email, secret: Secret.fromBase32(before.secret) }).toString() };
    },

    /** POST /sign-in/second-factor/enrolment/confirm's `before`: the unconfirmed factor's secret. */
    openForConfirm: async (_input: In<typeof confirmSecondFactorEnrolment>, deps: BeforeDeps): Promise<Opened> =>
      openFactor(deps, attempts, 'pending', false),

    /** POST /sign-in/second-factor/enrolment/confirm: the new factor's first code. It confirms the factor, signs the
     * person in and answers their recovery codes. */
    async confirmEnrolment(ctx: Ctx, { code }: In<typeof confirmSecondFactorEnrolment>, { before }: { before: Opened }):
      Promise<Out<typeof confirmSecondFactorEnrolment>> {
      const cookie = cookieOf(ctx);
      const pending = await pendingSignIn(ctx, cookie);
      await tryCount(pending.userId);
      if (!(await acceptCode(ctx, before, code))) throw invalid();
      const codes = await replaceCodes(ctx, pending.userId);
      await recordSecurityEvent(ctx, { kind: 'second_factor_changed', detail: { change: 'enrolled' } },
        { userId: pending.userId, device: cookie.device });
      await attempts.reset(pending.userId);
      await finishPendingSignIn(ctx, cookie, pending);
      return { recoveryCodes: codes };
    },

    /** POST /me/second-factor/recovery-codes's `before`: the signed-in person's confirmed factor. */
    openForNewCodes: async (_input: In<typeof newRecoveryCodes>, deps: BeforeDeps): Promise<Opened> =>
      openFactor(deps, attempts, 'signed_in', true),

    /** POST /me/second-factor/recovery-codes: signed in, with a current code; the old set stops working. */
    async newRecoveryCodes(ctx: Ctx, { code }: In<typeof newRecoveryCodes>, { before }: { before: Opened }):
      Promise<Out<typeof newRecoveryCodes>> {
      const userId = signedInUser(ctx);
      // The lock first: a locked account's `before` opened nothing, so null means locked as much as no factor.
      await tryCount(userId);
      if (before === null) throw new AppError('no_second_factor', 'Set up your authenticator app first');
      if (!(await acceptCode(ctx, before, code))) throw invalid();
      const codes = await replaceCodes(ctx, userId);
      await recordSecurityEvent(ctx, { kind: 'second_factor_changed', detail: { change: 'recovery_codes' } }, { userId, device: null });
      await attempts.reset(userId);
      return { recoveryCodes: codes };
    },

    /** POST /admin/users/:id/second-factor/remove (users:write): someone else's factor and codes, after a lost phone.
     * shortcut: the typed reason isn't kept yet; it joins the audit row when RAD-35/36 add how admin reasons are kept. */
    async remove(ctx: Ctx, { id }: In<typeof removeSecondFactor>): Promise<Out<typeof removeSecondFactor>> {
      if (ctx.principal.kind === 'user' && ctx.principal.userId === id) {
        throw new AppError('own_account', 'Another admin has to remove your own second factor');
      }
      const tx = platformTx(ctx);
      const removed = await tx.delete(secondFactors).where(eq(secondFactors.userId, id)).returning({ id: secondFactors.id });
      if (removed.length === 0) throw new AppError('no_second_factor', 'This person has no second factor to remove');
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, id));
      await recordSecurityEvent(ctx, { kind: 'second_factor_changed', detail: { change: 'removed' } }, { userId: id, device: null });
      return {};
    },
  });
}
