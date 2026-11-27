// What GSTR-1 reads (M5-04, RAD-154; ADR-010 §1, §2, §3): every line of a posted or cancelled invoice and credit note,
// with its document's frozen buyer, place of supply and dates, and, for a credit note, the invoice it lowers. Amounts
// as stored, a note's positive: the builder takes it off. A line's supply kind is frozen at posting; one posted before
// RAD-154 has none, and reads as nil at 0% and taxable above (its rate row's kind then, the CHECK on gst_rates).
import { sql } from 'drizzle-orm';
import { boolean, date, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { radcore } from '../src/columns.ts';

export const vGstOutwardLines = radcore.view('gst_outward_lines', {
  documentTable: text(),
  documentId: uuid(),
  documentNumber: text(),
  status: text(),
  documentDate: date({ mode: 'string' }),
  invoiceId: uuid(),
  invoiceNumber: text(),
  invoiceDate: date({ mode: 'string' }),
  invoiceValue: numeric(),
  buyerGstin: text(),
  placeOfSupply: text(),
  issuerStateCode: text(),
  ecommerceGstin: text(),
  late: boolean(),
  lineId: uuid(),
  hsn: text(),
  uqc: text(),
  qty: numeric(),
  gstRate: numeric(),
  supplyKind: text(),
  taxable: numeric(),
  cgst: numeric(),
  sgst: numeric(),
  igst: numeric(),
  cess: numeric(),
}).as(sql`select 'invoices' as document_table, i.id as document_id, i.number as document_number, i.status, i.business_date as document_date,
    i.id as invoice_id, i.number as invoice_number, i.business_date as invoice_date, i.total as invoice_value, i.buyer_gstin, i.place_of_supply,
    i.issuer_state_code, i.ecommerce_gstin, false as late, l.id as line_id, l.hsn, it.unit as uqc, l.qty, l.gst_rate,
    coalesce(l.supply_kind, case when l.gst_rate = 0 then 'nil' else 'taxable' end) as supply_kind,
    l.taxable, l.cgst, l.sgst, l.igst, l.cess_ad_valorem + l.cess_per_unit_amount as cess
  from radcore.invoices i join radcore.invoice_lines l on l.invoice_id = i.id join radcore.items it on it.id = l.item_id
  where i.status <> 'draft'
  union all
  select 'credit_notes', n.id, n.number, n.status, n.business_date, i.id, i.number, i.business_date, i.total, i.buyer_gstin, i.place_of_supply,
    i.issuer_state_code, i.ecommerce_gstin, n.late, l.id, il.hsn, it.unit, coalesce(l.qty, 0), l.gst_rate,
    coalesce(il.supply_kind, case when il.gst_rate = 0 then 'nil' else 'taxable' end),
    l.taxable, l.cgst, l.sgst, l.igst, 0
  from radcore.credit_notes n join radcore.credit_note_lines l on l.credit_note_id = n.id
    join radcore.invoice_lines il on il.id = l.invoice_line_id join radcore.invoices i on i.id = n.invoice_id
    join radcore.items it on it.id = il.item_id
  where n.status <> 'draft'`);
