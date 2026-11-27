// lib-platform's tables (ADR-001 §3). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { isNotNull, isNull, sql } from 'drizzle-orm';
import { boolean, check, index, integer, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { boundedText, id, json, radcoreTable } from '../columns.ts';

/**
 * Settings, and nothing else (RC-161): one row per setting a library declares with defineSetting, keyed
 * `<module>.<name>`. Job state lives with the jobs (M1-26) and the period lock with the books (M2), each in its own
 * table, so none of them can overwrite another. The value is JSON checked by the setting's own schema in lib-platform.
 */
export const settings = radcoreTable('settings', {
  key: text().primaryKey(),
  value: json().notNull(),
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
 * An integration's secret by its name (RAD-107, the architect): a provider's webhook key, app secret or verify token,
 * one of each, read for each request by lib-platform's storedSecret so a rotated one applies at once. Encrypted for its
 * place (`integration_secrets`, `ciphertext`, the name), so a ciphertext copied to another name doesn't decrypt. Set
 * with tools/set-secret.ts, by the owner login: the app login only reads it, and the read-only login can't.
 */
export const integrationSecrets = radcoreTable('integration_secrets', {
  name: text().primaryKey(),
  ciphertext: text().notNull(),
  keyId: text().notNull(),
}, (t) => [
  check('ck_integration_secrets_name', sql`${t.name} ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\\.[a-z][a-z0-9_]*$'`),
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
  answer: json(),
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
  // The person's one role (RAD-35, the plan's page 4): every person has one, given when they're invited.
  role: text().notNull().references(() => roles.key, { onDelete: 'restrict' }),
  // When the person gained their role (RAD-35): approval rules refuse a decider whose role is newer than the request.
  roleSince: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_users_status', sql`${t.status} in ('invited', 'active', 'disabled')`),
  // Active has a password, invited none; disabled either, as an invite can be deactivated (RAD-36).
  check('ck_users_password', sql`(${t.status} <> 'active' or ${t.passwordHash} is not null) and (${t.status} <> 'invited' or ${t.passwordHash} is null)`),
  uniqueIndex('ux_users_email_key').on(t.emailKey),
  index('ix_users_role').on(t.role),
]);

/** Roles (RAD-35, M1-17; the plan's page 4): each person signs in with one. `key` never changes; `name` is what people
 * see, and `name_key` (it without case or extra spaces) is unique, so no two roles look alike (RAD-83, RC-044). A role
 * needing the second sign-in factor says so (D-19). What a role may do is its grants. */
export const roles = radcoreTable('roles', {
  key: text().primaryKey(),
  name: boundedText({ max: 60 }).notNull(),
  nameKey: text().notNull().generatedAlwaysAs(sql`lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g')))`),
  description: boundedText({ max: 500 }).notNull(),
  secondFactorRequired: boolean().notNull().default(false),
}, (t) => [check('ck_roles_key', sql`${t.key} ~ '^[a-z][a-z_]{1,31}$'`), uniqueIndex('ux_roles_name_key').on(t.nameKey)]);

/** The built-in roles' templates (RAD-83): the grants each shipped with, seeded by migration; a reset restores them. */
export const roleTemplates = radcoreTable('role_templates', {
  role: text().notNull().references(() => roles.key, { onDelete: 'restrict' }),
  permission: text().notNull(), scope: text().notNull(),
}, (t) => [primaryKey({ name: 'pk_role_templates', columns: [t.role, t.permission] }),
  check('ck_role_templates_scope', sql`${t.scope} in ('all', 'own') and (${t.permission} not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock', 'bank:read', 'bank:reconcile') or ${t.scope} = 'all')`)]);

/**
 * What a role may do (RAD-35, ADR-001 §6a): one permission key each, at a scope. `all` reaches every record of that
 * kind; `own` only the records the person owns (ctx.can), so one key can mean "my leads" for one role and "every lead"
 * for another. The admin's grants hold every key at `all`; an allOnly key (parties:contact, RAD-90) only at `all`.
 */
export const roleGrants = radcoreTable('role_grants', {
  role: text().notNull().references(() => roles.key, { onDelete: 'cascade' }),
  permission: text().notNull(),
  scope: text().notNull(),
}, (t) => [
  primaryKey({ name: 'pk_role_grants', columns: [t.role, t.permission] }),
  check('ck_role_grants_permission', sql`${t.permission} ~ '^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$'`),
  check('ck_role_grants_scope', sql`${t.scope} in ('all', 'own') and (${t.permission} not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock', 'bank:read', 'bank:reconcile') or ${t.scope} = 'all')`),
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
  // The job that emailed this link (RAD-32): a job run twice finds its own row and sends nothing more.
  jobId: uuid(),
  // When the email went out. A link minted but never sent is spent and replaced on the job's retry.
  sentAt: timestamp({ withTimezone: true }),
}, (t) => [
  check(`ck_${name}_token_hash`, sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  uniqueIndex(`ux_${name}_token_hash`).on(t.tokenHash),
  uniqueIndex(`ux_${name}_job_id`).on(t.jobId),
  index(`ix_${name}_user_id`).on(t.userId),
]);
export const invites = linkToken('invites');
export const passwordResets = linkToken('password_resets');

/**
 * Jobs queued in a write's own transaction (ADR-002 §4, RAD-44, the outbox): `ctx.jobs.send` inserts a row here, so a
 * save that rolls back queues nothing. The worker's relay hands committed rows to pg-boss, with pg-boss's job id set to
 * the row's id, and deletes them (ADR-005 §7: a queue). `name` is the job's queue; `data` its checked input;
 * `principal` and `request_id` say who queued it and in which request, for the job's principal (ADR-001 §6a).
 * A row pg-boss won't take is tried again later, not first: `attempts` counts the failures, `next_attempt_at` backs it
 * off, and after the last try `dead_at` sets it aside with an alert, so a bad row never blocks the jobs behind it.
 * The read-only login can't read this table (its migration revokes radcore_read's SELECT): payloads may be personal.
 */
export const jobsOutbox = radcoreTable('jobs_outbox', {
  id: id(),
  name: text().notNull(),
  data: json().notNull(),
  principal: text().notNull(),
  requestId: text().notNull(),
  attempts: integer().notNull().default(0),
  nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deadAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_jobs_outbox_name', sql`${t.name} ~ '^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$'`),
  check('ck_jobs_outbox_attempts', sql`${t.attempts} >= 0`),
  // The relay's pass reads the live rows that are due, oldest first.
  index('ix_jobs_outbox_due').on(t.nextAttemptAt).where(isNull(t.deadAt)),
]);

/**
 * Webhook deliveries (ADR-001 §8a, RAD-45, RC-084): every signed delivery from an outside service, stored once before
 * it's answered, then handed to its job through the outbox in the same transaction. `source` is the webhook's route
 * (`POST /hooks/...`); `delivery_id` is the provider's own id, or a hash of the raw body where it sends none. Two unique
 * indexes are the replay guard, so a repeat is answered and acted on once: on the provider's id, and on `body_sha256`,
 * the SHA-256 of the signed raw body, because many providers send the id in an unsigned header that a resender could
 * change (auditor-2, RC-084). `payload` is the raw body as
 * received. `processed_at` is set by the job in its own transaction, so a delivery left unprocessed can be found
 * and alerted on. The read-only login can't read it (its migration revokes radcore_read): payloads may be personal.
 */
export const webhookDeliveries = radcoreTable('webhook_deliveries', {
  id: id(),
  source: text().notNull(),
  deliveryId: text().notNull(),
  bodySha256: text().notNull(),
  payload: text().notNull(),
  processedAt: timestamp({ withTimezone: true }),
}, (t) => [
  uniqueIndex('ux_webhook_deliveries_source_delivery_id').on(t.source, t.deliveryId),
  uniqueIndex('ux_webhook_deliveries_source_body_sha256').on(t.source, t.bodySha256),
  check('ck_webhook_deliveries_body_sha256', sql`${t.bodySha256} ~ '^[0-9a-f]{64}$'`),
  // The stuck-delivery watch reads the unprocessed ones, oldest first.
  index('ix_webhook_deliveries_unprocessed').on(t.createdAt).where(isNull(t.processedAt)),
]);
/**
 * Approvals (maker-checker, RAD-38, RC-037): one row per request for a second person to approve a record of `kind`
 * (`purchase-order`, `stock-adjustment`, ...). `version_digest` is the SHA-256 of the exact version the request was made
 * for; an approval goes through only if the record still hashes to it and the approver's screen saw the same hash.
 * `requested_by` and `decided_by` are principal ids (`user:<id>`), never the same one on an approved or rejected row.
 * A new request for the same record supersedes the pending one (its `decided_at` is then when), so at most one is
 * pending per record. Audited like any record.
 */
export const approvals = radcoreTable('approvals', {
  id: id(),
  kind: text().notNull(),
  recordId: uuid().notNull(),
  // A digest, not a secret: named so, since the audit rules treat a `*hash*` column as one to redact (ADR-005 §7c).
  versionDigest: text().notNull(),
  requestedBy: text().notNull(),
  status: text().notNull().default('pending'),
  decidedBy: text(),
  decidedAt: timestamp({ withTimezone: true }),
  reason: boundedText({ max: 500 }),
}, (t) => [
  check('ck_approvals_kind', sql`${t.kind} ~ '^[a-z][a-z0-9-]*$'`),
  check('ck_approvals_version_digest', sql`${t.versionDigest} ~ '^[0-9a-f]{64}$'`),
  check('ck_approvals_status', sql`${t.status} in ('pending', 'approved', 'rejected', 'superseded')`),
  // Only a pending request has no decided_at (a superseded one has the time it was superseded); an approval or
  // rejection names who decided, and it's never the requester (RC-037).
  check('ck_approvals_decided', sql`(${t.status} = 'pending') = (${t.decidedAt} is null)
    and (${t.status} in ('approved', 'rejected')) = (${t.decidedBy} is not null)
    and (${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy})`),
  // At most one pending request per record.
  uniqueIndex('ux_approvals_pending').on(t.kind, t.recordId).where(isNull(t.decidedAt)),
  index('ix_approvals_kind_status').on(t.kind, t.status, t.createdAt),
]);


/**
 * The first admin (ADR-004 §3, RC-021): one permanent row, made by the bootstrap-admin command, so its invite is minted
 * once ever and a later deploy can't mint another. The runtime login may add it, never change or remove it.
 */
export const bootstrap = radcoreTable('bootstrap', {
  key: text().primaryKey(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'restrict' }),
}, (t) => [
  check('ck_bootstrap_key', sql`${t.key} = 'first_admin'`),
  uniqueIndex('ux_bootstrap_user_id').on(t.userId),
]);

/**
 * Files people upload (RAD-43, ADR-004 §2, RC-096, RC-191); an export is RAD-47's own row. The bytes live in S3, under
 * `store_key` (`<kind>/<uuid>`, made by the server); this row is what the app knows about them. A browser upload is
 * `pending` until the person confirms it, `checking` while a job checks it in S3 (size, type, magic bytes: a network
 * call, so never inside a request's transaction, ADR-001 §8), then `ready` or `refused`. Only a ready file downloads.
 * `filename` is the name the person gave it, shown on download. Kept permanently, like all data (D-12): there's no
 * deletion job. Audited like any record.
 */
export const files = radcoreTable('files', {
  id: id(),
  kind: text().notNull(),
  storeKey: text().notNull(),
  filename: boundedText({ max: 255 }).notNull(),
  contentType: text().notNull(),
  size: integer(),
  status: text().notNull().default('pending'),
}, (t) => [
  uniqueIndex('ux_files_store_key').on(t.storeKey),
  check('ck_files_kind', sql`${t.kind} in ('photo', 'resume', 'statement', 'import', 'item_picture', 'delivery_photo', 'delivery_note', 'purchase_bill')`),
  check('ck_files_status', sql`${t.status} in ('pending', 'checking', 'ready', 'refused')`),
  check('ck_files_store_key', sql`${t.storeKey} ~ ('^' || ${t.kind} || '/[0-9a-f-]{36}$')`),
  // A ready file has its checked size.
  check('ck_files_size', sql`(${t.status} <> 'ready' or ${t.size} is not null) and (${t.size} is null or ${t.size} > 0)`),
]);

/**
 * Exports (RAD-47 part 2, ADR-002 Exports): one row per export a person starts, owned by `created_by`, who alone may
 * read its status or download it. The export job fills it after its own transaction: `ready` with the row count and the
 * file's store key, or `failed` with why. Never cut short (RC-086): `too_large` past EXPORT_MAX_ROWS or a full volume.
 * `kind` is the list, `<module>.<name>`, naming the module's row function; `filter` is its filter as sent, checked by
 * that list's schema when the job runs; `format` is a list's CSV or a workbook's XLSX (RAD-92), naming the download.
 */
export const dataExports = radcoreTable('exports', {
  id: id(),
  kind: text().notNull(),
  filter: json().notNull(),
  status: text().notNull().default('queued'),
  rows: integer(),
  storeKey: text(),
  failure: text(),
  format: text().notNull().default('csv'),
}, (t) => [
  uniqueIndex('ux_exports_store_key').on(t.storeKey), check('ck_exports_format', sql`${t.format} in ('csv', 'xlsx')`),
  check('ck_exports_kind', sql`${t.kind} ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\\.[a-z][a-z0-9_-]*$'`),
  check('ck_exports_status', sql`${t.status} in ('queued', 'ready', 'failed')`),
  check('ck_exports_failure', sql`(${t.status} = 'failed') = (${t.failure} is not null)
    and (${t.failure} is null or ${t.failure} in ('too_large', 'failed'))`),
  // A ready export has its file and its count; nothing else has a file.
  check('ck_exports_ready', sql`(${t.status} = 'ready') = (${t.storeKey} is not null)
    and ((${t.status} = 'ready') = (${t.rows} is not null)) and (${t.rows} is null or ${t.rows} >= 0)`),
  check('ck_exports_store_key', sql`${t.storeKey} is null or ${t.storeKey} ~ '^export/[0-9a-f-]{36}$'`),
]);

/** Number series (RAD-87, ADR-006 §3): per series and financial year, the prefix its first number took and the last
 * number drawn. A trigger moves `last` up by exactly one and keeps the prefix. A year's row can be made ahead of its
 * first number, with `last` 0, to hold a prefix change for that year (RAD-132). Machinery (ADR-005 §7c). */
export const numberCounters = radcoreTable('number_counters', {
  series: text().notNull(), financialYear: text().notNull(), prefix: text().notNull(), last: integer().notNull().default(1),
}, (t) => [primaryKey({ name: 'pk_number_counters', columns: [t.series, t.financialYear] })]);

/** A series' prefix history (RAD-132, ADR-006 §3, ADR-001 §8c): the prefix from `from_year` on, one row per series and
 * year, so a second change for one year replaces the first. A year's first number takes the latest row on or before
 * it, else the series' declared prefix (the counter's insert trigger). Audited. */
export const seriesPrefixes = radcoreTable('series_prefixes', {
  series: text().notNull(), fromYear: text().notNull(), prefix: text().notNull(),
}, (t) => [
  primaryKey({ name: 'pk_series_prefixes', columns: [t.series, t.fromYear] }),
  check('ck_series_prefixes_from_year', sql`${t.fromYear} ~ '^[0-9]{4}-[0-9]{2}$'`),
  check('ck_series_prefixes_prefix', sql`${t.prefix} ~ '^[A-Z0-9]{1,4}$'`),
]);

/** Why a change was made (RAD-36, ADR-005 §7c): its audit rows carry this id, never the text. Written only through
 * radcore.record_change_reason; not copied into the audit log. */
export const changeReasons = radcoreTable('change_reasons', {
  id: id(),
  reason: boundedText({ max: 500 }).notNull(),
});

/**
 * Public links (RAD-41, ADR-001 §6a, RC-047): a link sent to a customer or a member of staff (an invoice, an estimate,
 * a payslip) lets its holder do one `action` on one record, `record_id` in `record_table`, until `expires_at`, unless
 * revoked first.
 * Only the SHA-256 of its token is stored (`token_hash`), and nothing else ever holds the token: other tables, and the
 * audit trail (`link:<id>`), name the link by its id. `uses_left` counts down for a link with a set number of uses
 * (null: any number until it expires). Audited, with the hash redacted; the read-only login can't read the hash.
 */
export const publicLinks = radcoreTable('public_links', {
  id: id(),
  action: text().notNull(),
  // The table the record is in, as access_log names it (the architect on RAD-41): set by the module making the link.
  recordTable: text().notNull(),
  recordId: uuid().notNull(),
  tokenHash: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usesLeft: integer(),
  revokedAt: timestamp({ withTimezone: true }),
  revokedBy: text(),
}, (t) => [
  check('ck_public_links_action', sql`${t.action} ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$'`),
  check('ck_public_links_token_hash', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  // A table of radcore's, by its plain name: "who opened this record?" finds a link's openings under it.
  check('ck_public_links_record_table', sql`${t.recordTable} ~ '^[a-z][a-z0-9_]*$' and to_regclass('radcore.' || ${t.recordTable}) is not null`),
  check('ck_public_links_uses_left', sql`${t.usesLeft} is null or ${t.usesLeft} >= 0`),
  // A revocation says who revoked it, and when.
  check('ck_public_links_revoked', sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`),
  uniqueIndex('ux_public_links_token_hash').on(t.tokenHash),
  index('ix_public_links_action_record_id').on(t.action, t.recordId),
]);

/**
 * In-app notifications (M3-17, RAD-121, RC-142): who it's for, its kind (`<module>.<name>`) and the record it's about,
 * by table and id. References, never copies: its text is built when it's read, for the viewer and masked for them
 * (M6-16). `at` is read as text so a page key keeps its microseconds (lists.ts). Machinery (ADR-005 §7c): the app may
 * only add one and mark it read.
 */
export const notifications = radcoreTable('notifications', {
  id: id(),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'restrict' }),
  kind: text().notNull(),
  recordTable: text().notNull(),
  recordId: uuid().notNull(),
  at: timestamp({ withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  readAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_notifications_kind', sql`${t.kind} ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\.[a-z][a-z0-9_]*$'`),
  check('ck_notifications_record_table', sql`${t.recordTable} ~ '^[a-z][a-z0-9_]*$' and to_regclass('radcore.' || ${t.recordTable}) is not null`),
  index('ix_notifications_user_at').on(t.userId, t.at, t.id),
  index('ix_notifications_unread').on(t.userId).where(isNull(t.readAt)),
]);
