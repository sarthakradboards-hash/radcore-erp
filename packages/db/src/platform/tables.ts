// lib-platform's tables (ADR-001 §3). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { isNotNull, sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, radcoreTable } from '../columns.ts';

/**
 * Settings, and nothing else (RC-161): one row per setting a library declares with defineSetting, keyed
 * `<module>.<name>`. Job state lives with the jobs (M1-26) and the period lock with the books (M2), each in its own
 * table, so none of them can overwrite another. The value is JSON checked by the setting's own schema in lib-platform.
 */
export const settings = radcoreTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
}, (t) => [check('ck_settings_key', sql`${t.key} ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\\.[a-z][a-z0-9_]*$'`)]);

/**
 * Stored secrets (RC-213, RAD-65): an outside service's token or a bank-statement password, encrypted by
 * lib-platform's createSecrets for this row's place (`secrets`, `ciphertext`, `id`), so a ciphertext copied into
 * another row doesn't decrypt. The table that needs a secret points at its row by id.
 * - `name` says what kind of secret it is (`<module>.<name>`, for the expiry alert). It isn't unique: two Shopify
 *   shops each have a `crm.shopify_token`.
 * - `key_id` names the key that wrapped it, so a rotation finds what an old key still holds.
 * - `expires_at` is the outside service's expiry, null when it has none; the partial index serves the expiry watch.
 * The read-only login can't see this table (its migration revokes radcore_read's SELECT).
 */
export const secrets = radcoreTable('secrets', {
  id: id(),
  name: text().notNull(),
  ciphertext: text().notNull(),
  keyId: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_secrets_name', sql`${t.name} ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\\.[a-z][a-z0-9_]*$'`),
  index('ix_secrets_expires_at').on(t.expiresAt).where(isNotNull(t.expiresAt)),
]);

/**
 * Saved-once (ADR-001 §6, §7a; RAD-27, RC-132): one row per write a principal sent with an Idempotency-Key, claimed in
 * the write's own transaction under the primary key, so a second request with the same key waits for the first and
 * then replays its answer, or runs if the first rolled back.
 * - `input_hash` is the SHA-256 of the checked input: the same key with another body is refused.
 * - `answer` is the checked output, kept only when `kept`; a route whose answer holds a secret claims the key and
 *   keeps nothing (`storesAnswer: false`, RAD-32).
 * - `expires_at` is when the clean-up job may delete the row: 48 hours for a screen's write, 30 days for sync.
 */
export const savedOnce = radcoreTable('saved_once', {
  principal: text().notNull(),
  route: text().notNull(),
  key: uuid().notNull(),
  inputHash: text().notNull(),
  answer: jsonb(),
  kept: boolean().notNull().default(false),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ name: 'pk_saved_once', columns: [t.principal, t.route, t.key] }),
  check('ck_saved_once_input_hash', sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
  index('ix_saved_once_expires_at').on(t.expiresAt),
]);

/**
 * The people who sign in (M1-14). `email` is stored as lib-common's normaliseEmail gives it, and `email_key`
 * (lower(btrim(email)), generated) is unique, so two addresses that differ only in case can't both exist (RC-045).
 * `password_hash` is Argon2id (ADR-003), null until the person sets one from their invite: nobody else ever knows it.
 */
export const users = radcoreTable('users', {
  id: id(),
  email: boundedText({ max: 254 }).notNull(),
  emailKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(email))`),
  displayName: boundedText({ max: 120 }).notNull(),
  passwordHash: text(),
  passwordSetAt: timestamp({ withTimezone: true }),
  status: text().notNull().default('invited'),
}, (t) => [
  check('ck_users_status', sql`${t.status} in ('invited', 'active', 'disabled')`),
  // Active means a password is set; invited means none yet.
  check('ck_users_password', sql`(${t.status} = 'invited') = (${t.passwordHash} is null)`),
  uniqueIndex('ux_users_email_key').on(t.emailKey),
]);

/**
 * One-time links (RAD-61, RAD-64): an invite to set a first password, and a password reset. Only the SHA-256 of the
 * token is stored, so the table can't be used to sign anyone in. A token is single-use and expires; neither kind
 * starts a session.
 */
const linkToken = <TName extends string>(name: TName) => radcoreTable(name, {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'restrict' }),
  tokenHash: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check(`ck_${name}_token_hash`, sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  uniqueIndex(`ux_${name}_token_hash`).on(t.tokenHash),
  index(`ix_${name}_user_id`).on(t.userId),
]);
export const invites = linkToken('invites');
export const passwordResets = linkToken('password_resets');
