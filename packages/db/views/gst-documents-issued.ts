// GSTR-1 Table 13's documents (M5-04, RAD-154; ADR-010 §3; the architect on #457): every posted or cancelled invoice,
// credit note and job-work delivery challan (ADR-008 §11), with its number, date, status and the portal's document type.
// A challan carries no GST line, so it isn't in gst_outward_lines; lib-gst reads documents only through views (§1).
import { sql } from 'drizzle-orm';
import { date, text, uuid } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vGstDocumentsIssued = radcore.view('gst_documents_issued', {
  documentTable: text(),
  documentId: uuid(),
  documentType: text(),
  documentNumber: text(),
  documentDate: date({ mode: 'string' }),
  status: text(),
}).as(sql`select 'invoices' as document_table, id as document_id, 'Invoices for outward supply' as document_type, number as document_number,
    business_date as document_date, status
  from radcore.invoices where status <> 'draft'
  union all
  select 'credit_notes', id, 'Credit Note', number, business_date, status from radcore.credit_notes where status <> 'draft'
  union all
  select 'job_work_challans', id, 'Delivery Challan for job work', number, business_date, status from radcore.job_work_challans
  where status <> 'draft'`);
