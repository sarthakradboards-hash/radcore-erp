// ADR-005 §7c (RAD-30): an audited table's secret and hash columns are written to audit_log as "[redacted]", from the
// list radcore.audit_attach was given. Each row is a column named like a secret (hash, secret, token, ciphertext or
// password) that its table's audit trigger would write in full, permanently. A later migration that adds such a
// column must attach the table again with it. Read by tools/schema.test.ts.
import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vUnredactedSecrets = radcore.view('v_schema_unredacted_secrets', {
  tableName: text(),
  columnName: text(),
}).as(sql`select c.relname::text as table_name, a.attname::text as column_name
  from pg_catalog.pg_trigger g
  join pg_catalog.pg_class c on c.oid = g.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where g.tgname = 'audit_row' and not g.tgisinternal and n.nspname = 'radcore'
    and a.attname ~ '(hash|secret|token|ciphertext|password)'
    and not (a.attname = any (string_to_array(split_part(encode(g.tgargs, 'escape'), '\\000', 2), ',')))`);
