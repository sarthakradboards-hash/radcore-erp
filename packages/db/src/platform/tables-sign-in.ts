// lib-platform's sign-in tables (ADR-001 §7a): moved as they were out of tables.ts, which had reached E2's 400 lines
// (the architect on RAD-92). Named in every list of table files, never by a glob. SQL zone (ADR-002 §3): `sql` only as
// a CHECK's or generated column's argument.
import { sql } from 'drizzle-orm';
import { check, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, radcoreTable } from '../columns.ts';
import { users } from './tables.ts';

/** When each person last signed in (RAD-36): made with the person by a trigger on users (0031), set when a session
 * starts. Machinery, not row-audited (ADR-005 §7c): a sign-in is already a `sign_in` event. The people list sorts on
 * `sort_key`, epoch for never, since a sort key is never null; text mode keeps its microseconds for the page key. */
export const userSignIns = radcoreTable('user_sign_ins', {
  userId: uuid().primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  lastSignInAt: timestamp({ withTimezone: true }),
  sortKey: timestamp({ withTimezone: true, mode: 'string' }).notNull()
    .generatedAlwaysAs(sql`coalesce(last_sign_in_at, timestamptz 'epoch')`),
}, (t) => [index('ix_user_sign_ins_sort_key').on(t.sortKey, t.userId)]);

/** Sign-in sessions (RAD-34, ADR-001 §7a): the cookie's token, stored as its SHA-256. Past either expiry, or ended, a
 * session signs nobody in. `device` names the browser, never an address. Not row-audited (ADR-005 §7c). */
export const sessions = radcoreTable('sessions', {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'restrict' }),
  tokenHash: text().notNull(),
  device: boundedText({ max: 80 }).notNull(),
  // Read as PostgreSQL's own text: the session lists page on it (lib-platform's momentKey).
  lastSeenAt: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  idleExpiresAt: timestamp({ withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp({ withTimezone: true }).notNull(),
  endedAt: timestamp({ withTimezone: true }),
  endedReason: text(),
}, (t) => [
  check('ck_sessions_token_hash', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check('ck_sessions_ended_reason', sql`${t.endedReason} in ('sign_out', 'admin', 'password_changed', 'password_reset', 'role_changed', 'deactivated')`),
  check('ck_sessions_ended', sql`(${t.endedAt} is null) = (${t.endedReason} is null)`),
  uniqueIndex('ux_sessions_token_hash').on(t.tokenHash),
  index('ix_sessions_user_id').on(t.userId),
]);

/** A person's TOTP authenticator (RAD-33, D-19): `secret` is the secrets library's ciphertext for this row. Unconfirmed
 * until its first code; `last_step` is the last accepted 30-second step, so a code works once (ADR-003). */
export const secondFactors = radcoreTable('second_factors', {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'restrict' }),
  secret: text().notNull(),
  secretKeyId: text().notNull(),
  confirmedAt: timestamp({ withTimezone: true }),
  lastStep: integer(),
}, (t) => [
  uniqueIndex('ux_second_factors_user_id').on(t.userId),
]);

/** Recovery codes (M1-15, RAD-64): ten per set, each its Argon2id hash. Each works once; a new set replaces them. */
export const recoveryCodes = radcoreTable('recovery_codes', {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'restrict' }),
  codeHash: text().notNull(),
  usedAt: timestamp({ withTimezone: true }),
}, (t) => [
  index('ix_recovery_codes_user_id').on(t.userId),
]);

/** A sign-in between its password and its second factor (RAD-33): the pending cookie's token, stored as its SHA-256,
 * for five minutes, spent when the sign-in finishes. */
export const pendingSignIns = radcoreTable('pending_sign_ins', {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'restrict' }),
  tokenHash: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_pending_sign_ins_token_hash', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  uniqueIndex('ux_pending_sign_ins_token_hash').on(t.tokenHash),
  index('ix_pending_sign_ins_user_id').on(t.userId),
]);
