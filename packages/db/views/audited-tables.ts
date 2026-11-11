// RAD-30 part 2: the tables the audit trigger watches, by name, for the audit viewer's table filter
// (listAuditedTables). A table is audited when its migration ran radcore.audit_attach with capture on, which gives it
// the `audit_row` trigger; machinery attached with capture off (saved_once, jobs_outbox) has none, so it isn't listed.
import { sql } from 'drizzle-orm';
import { text } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vAuditedTables = radcore.view('v_audited_tables', {
  tableName: text(),
}).as(sql`select c.relname::text as table_name
    from pg_catalog.pg_trigger g
    join pg_catalog.pg_class c on c.oid = g.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where g.tgname = 'audit_row' and not g.tgisinternal and n.nspname = 'radcore'`);
