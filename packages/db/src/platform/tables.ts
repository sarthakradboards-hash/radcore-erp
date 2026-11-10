// lib-platform's tables (ADR-001 §3). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { sql } from 'drizzle-orm';
import { check, text, timestamp } from 'drizzle-orm/pg-core';
import { id, radcoreTable } from '../columns.ts';

/**
 * Stored secrets (RC-213, RAD-65): an outside service's token or a bank-statement password, encrypted by
 * lib-platform's createSecrets for this row's place (`secrets`, `ciphertext`, `id`), so a ciphertext copied into
 * another row doesn't decrypt. The table that needs a secret points at its row. `name` says what it is
 * (`<module>.<name>`, for the expiry alert); `key_id` names the key that wrapped it, so rotation finds what an old key
 * still holds; `expires_at` is the outside service's expiry, null when it has none.
 */
export const secrets = radcoreTable('secrets', {
  id: id(),
  name: text().notNull(),
  ciphertext: text().notNull(),
  keyId: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_secrets_name', sql`${t.name} ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\\.[a-z][a-z0-9_]*$'`),
]);
