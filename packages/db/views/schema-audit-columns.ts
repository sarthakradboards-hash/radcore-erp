// ADR-005 §7c (RAD-30, M6-16: references, not copies): every column of an audited table is listed when its trigger is
// attached, as kept or redacted, so nothing reaches the append-only audit_log by default. Each row is a column that
// breaks that: one listed nowhere (the primary key and the four audit columns aside), one listed both ways, or one
// named like a secret (hash, secret, token, ciphertext, password) and able to hold one (not a time, date, boolean or
// number, so password_set_at is fine) that isn't redacted. A migration that adds a column attaches its table again.
// Read by tools/schema.test.ts.
import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vAuditColumns = radcore.view('v_schema_audit_columns', {
  tableName: text(),
  columnName: text(),
  problem: text(),
}).as(sql`with audited as (
    select c.oid, c.relname,
      string_to_array(split_part(encode(g.tgargs, 'escape'), '\\000',1), ',') as keys,
      string_to_array(nullif(split_part(encode(g.tgargs, 'escape'), '\\000',2), ''), ',') as keep,
      string_to_array(nullif(split_part(encode(g.tgargs, 'escape'), '\\000',3), ''), ',') as redact
    from pg_catalog.pg_trigger g
    join pg_catalog.pg_class c on c.oid = g.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where g.tgname = 'audit_row' and not g.tgisinternal and n.nspname = 'radcore'
  ), columns as (
    select t.relname, a.attname,
      a.attname = any (coalesce(t.keep, '{}')) as kept, a.attname = any (coalesce(t.redact, '{}')) as redacted,
      a.attname ~ '(hash|secret|token|ciphertext|password)' and a.atttypid not in ('timestamptz'::regtype,
        'timestamp'::regtype, 'date'::regtype, 'bool'::regtype, 'int4'::regtype, 'int8'::regtype, 'numeric'::regtype) as secret_like,
      a.attname = any (t.keys || array['created_at', 'created_by', 'updated_at', 'updated_by']) as exempt
    from audited t
    join pg_catalog.pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  )
  select relname::text as table_name, attname::text as column_name, 'unlisted' as problem from columns
    where not exempt and not kept and not redacted
  union all
  select relname::text, attname::text, 'kept and redacted' from columns where kept and redacted
  union all
  select relname::text, attname::text, 'a secret not redacted' from columns
    where secret_like and not redacted`);
