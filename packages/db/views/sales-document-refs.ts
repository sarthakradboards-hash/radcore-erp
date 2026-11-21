// A sales document's own number and date, by table and id (RAD-119, the architect's ruling; ADR-001 §5's cross-module
// read): lib-accounts' party statement shows an invoice's number beside its entry without reading a sales table.
// Sales-owned (backend-3's OK on RAD-119): each numbered sales document adds its row here, a numbered one being any
// not a draft. Rows reach a person only through a route under receivables:read.
import { sql } from 'drizzle-orm';
import { date, text, uuid } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vSalesDocumentRefs = radcore.view('v_sales_document_refs', {
  documentTable: text(),
  documentId: uuid(),
  number: text(),
  businessDate: date({ mode: 'string' }),
}).as(sql`select 'invoices'::text as document_table, i.id as document_id, i.number, i.business_date
  from radcore.invoices i where i.status <> 'draft'
  union all
  select 'credit_notes'::text, c.id, c.number, c.business_date from radcore.credit_notes c where c.status <> 'draft'`);
