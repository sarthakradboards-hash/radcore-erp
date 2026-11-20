// What has been paid against each document (M3-12, RAD-116; ADR-005 §7a, the architect's ruling): per document, by
// table and id, its net allocations, its net credit applications and their sum, `paid`. From lib-accounts' two tables
// alone: it holds no total and no balance, so no document's migration rewrites it. The document's owner subtracts
// `paid` from its own `total` (lib-sales for invoices), so lib-accounts neither writes nor reads a sales table.
import { sql } from 'drizzle-orm';
import { numeric, text, uuid } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vDocumentPaid = radcore.view('v_document_paid', {
  documentTable: text(),
  documentId: uuid(),
  allocated: numeric(),
  credited: numeric(),
  paid: numeric(),
}).as(sql`select document_table, document_id, sum(allocated) as allocated, sum(credited) as credited,
    sum(allocated + credited) as paid
  from (select a.document_table, a.document_id, case a.direction when 'apply' then a.amount else -a.amount end as allocated,
      0::numeric as credited
    from radcore.payment_allocations a
    union all
    select c.document_table, c.document_id, 0::numeric, case c.direction when 'apply' then c.amount else -c.amount end
    from radcore.credit_applications c) as m
  group by document_table, document_id`);
