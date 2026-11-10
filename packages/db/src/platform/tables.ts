// lib-platform's tables (ADR-001 §3). SQL zone (ADR-002 §3): `sql` only as a CHECK's argument.
import { sql } from 'drizzle-orm';
import { check, jsonb, text } from 'drizzle-orm/pg-core';
import { radcoreTable } from '../columns.ts';

/**
 * Settings, and nothing else (RC-161): one row per setting a library declares with defineSetting, keyed
 * `<module>.<name>`. Job state lives with the jobs (M1-26) and the period lock with the books (M2), each in its own
 * table, so none of them can overwrite another. The value is JSON checked by the setting's own schema in lib-platform.
 */
export const settings = radcoreTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
}, (t) => [check('ck_settings_key', sql`${t.key} ~ '^(platform|hr|gst|ops|accounts|crm|stock|payroll|purchasing|sales|service)\\.[a-z][a-z0-9_]*$'`)]);
