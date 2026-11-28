DROP VIEW "radcore"."gst_outward_lines";--> statement-breakpoint
CREATE VIEW "radcore"."gst_documents_issued" AS (select 'invoices' as document_table, id as document_id, 'Invoices for outward supply' as document_type, number as document_number,
    business_date as document_date, status
  from radcore.invoices where status <> 'draft'
  union all
  select 'credit_notes', id, 'Credit Note', number, business_date, status from radcore.credit_notes where status <> 'draft'
  union all
  select 'job_work_challans', id, 'Delivery Challan for job work', number, business_date, status from radcore.job_work_challans
  where status <> 'draft');--> statement-breakpoint
CREATE VIEW "radcore"."gst_outward_lines" AS (select 'invoices' as document_table, i.id as document_id, i.number as document_number, i.status, i.business_date as document_date,
    i.id as invoice_id, i.number as invoice_number, i.business_date as invoice_date, i.total as invoice_value, i.buyer_gstin, i.place_of_supply,
    i.issuer_state_code, i.ecommerce_gstin, false as late, l.id as line_id, l.hsn, it.unit as uqc, l.qty, l.gst_rate,
    l.supply_kind,
    l.taxable, l.cgst, l.sgst, l.igst, l.cess_ad_valorem + l.cess_per_unit_amount as cess, i.total as document_value
  from radcore.invoices i join radcore.invoice_lines l on l.invoice_id = i.id join radcore.items it on it.id = l.item_id
  where i.status <> 'draft'
  union all
  select 'credit_notes', n.id, n.number, n.status, n.business_date, i.id, i.number, i.business_date, i.total, i.buyer_gstin, i.place_of_supply,
    i.issuer_state_code, i.ecommerce_gstin, n.late, l.id, il.hsn, it.unit, coalesce(l.qty, 0), l.gst_rate,
    l.supply_kind,
    l.taxable, l.cgst, l.sgst, l.igst, 0, n.total
  from radcore.credit_notes n join radcore.credit_note_lines l on l.credit_note_id = n.id
    join radcore.invoice_lines il on il.id = l.invoice_line_id join radcore.invoices i on i.id = n.invoice_id
    join radcore.items it on it.id = il.item_id
  where n.status <> 'draft');--> statement-breakpoint
-- RAD-154 (the architect and the auditor on #457): Table 13's documents, job-work challans included, and a credit note's own
-- value for 9B. Both views are read, never written; gst_outward_lines was dropped and made again, so its revoke too.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.gst_documents_issued, radcore.gst_outward_lines FROM radcore_app;
