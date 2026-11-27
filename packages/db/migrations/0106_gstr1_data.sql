ALTER TABLE "radcore"."role_grants" DROP CONSTRAINT "ck_role_grants_scope";--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" DROP CONSTRAINT "ck_role_templates_scope";--> statement-breakpoint
ALTER TABLE "radcore"."gst_rates" ADD COLUMN "supply_kind" text DEFAULT 'taxable' NOT NULL;--> statement-breakpoint
-- RAD-154 (ADR-010 §2): a 0% rate is nil-rated, never a sale at 0% (RC-107); the CHECK below holds it. The CA marks a
-- row exempt or non-GST where it is one (CA-07).
SELECT set_config('app.principal', 'system:migrate', true);--> statement-breakpoint
UPDATE radcore.gst_rates SET supply_kind = 'nil' WHERE rate = 0;--> statement-breakpoint
ALTER TABLE "radcore"."invoice_lines" ADD COLUMN "supply_kind" text;--> statement-breakpoint
ALTER TABLE "radcore"."invoices" ADD COLUMN "ecommerce_gstin" text;--> statement-breakpoint
ALTER TABLE "radcore"."gst_rates" ADD CONSTRAINT "ck_gst_rates_supply_kind" CHECK ("radcore"."gst_rates"."supply_kind" in ('taxable', 'nil', 'exempt', 'non_gst') and ("radcore"."gst_rates"."supply_kind" = 'taxable') = ("radcore"."gst_rates"."rate" > 0));--> statement-breakpoint
ALTER TABLE "radcore"."role_grants" ADD CONSTRAINT "ck_role_grants_scope" CHECK ("radcore"."role_grants"."scope" in ('all', 'own') and ("radcore"."role_grants"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock', 'bank:read', 'bank:reconcile', 'tds:read', 'gst:returns') or "radcore"."role_grants"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."role_templates" ADD CONSTRAINT "ck_role_templates_scope" CHECK ("radcore"."role_templates"."scope" in ('all', 'own') and ("radcore"."role_templates"."permission" not in ('parties:contact', 'leads:contact', 'leads:unassigned', 'campaigns:read', 'campaigns:write', 'money_accounts:read', 'sales:counter_credit', 'receipts:print', 'payments:read', 'books:lock', 'books:unlock', 'bank:read', 'bank:reconcile', 'tds:read', 'gst:returns') or "radcore"."role_templates"."scope" = 'all'));--> statement-breakpoint
ALTER TABLE "radcore"."invoice_lines" ADD CONSTRAINT "ck_invoice_lines_supply_kind" CHECK ("radcore"."invoice_lines"."supply_kind" is null or ("radcore"."invoice_lines"."gst_rate" is not null
    and "radcore"."invoice_lines"."supply_kind" in ('taxable', 'nil', 'exempt', 'non_gst') and ("radcore"."invoice_lines"."supply_kind" = 'taxable') = ("radcore"."invoice_lines"."gst_rate" > 0)));--> statement-breakpoint
ALTER TABLE "radcore"."invoices" ADD CONSTRAINT "ck_invoices_ecommerce_gstin" CHECK ("radcore"."invoices"."ecommerce_gstin" is null or "radcore"."invoices"."ecommerce_gstin" ~ '^[0-9]{2}[A-Z0-9]{13}$');--> statement-breakpoint
CREATE VIEW "radcore"."gst_outward_lines" AS (select 'invoices' as document_table, i.id as document_id, i.number as document_number, i.status, i.business_date as document_date,
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
  where n.status <> 'draft');
--> statement-breakpoint
-- Kept in the audit trail with the rest of each row (RAD-154).
SELECT radcore.audit_attach('gst_rates', keep => array['hsn', 'effective_from', 'rate', 'source', 'note', 'supply_kind']);
--> statement-breakpoint
SELECT radcore.audit_attach('invoices',
  keep => array['status', 'number', 'party_id', 'owner', 'price_list_id', 'business_date', 'notes', 'ship_to_name', 'ship_to_state_code', 'issuer_legal_name',
    'issuer_gstin', 'issuer_address_line1', 'issuer_address_line2', 'issuer_city', 'issuer_pincode', 'issuer_state_code', 'buyer_name',
    'buyer_gstin', 'buyer_state_code', 'place_of_supply', 'ecommerce_gstin', 'taxable', 'cgst', 'sgst', 'igst', 'cess', 'round_off', 'total',
    'override_version', 'override_after', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id'],
  redact => array['ship_to_address', 'buyer_address_line1', 'buyer_address_line2', 'buyer_city', 'buyer_pincode']);
--> statement-breakpoint
SELECT radcore.audit_attach('invoice_lines', keep => array['invoice_id', 'line_no', 'delivery_line_id', 'item_id', 'qty', 'rate',
  'discount_percent', 'list_rate', 'list_version_id', 'hsn', 'gst_rate', 'gst_rate_source', 'taxable', 'cgst', 'sgst', 'igst', 'cess_ad_valorem', 'cess_per_unit_amount',
  'line_total', 'cost', 'delivery_taxable', 'delivery_gst', 'unit_condition', 'supply_kind'], owner => 'invoice_id', owner_table => 'invoices');
--> statement-breakpoint
-- gst:returns (ADR-010 §15): an ordinary catalogue key any role can be given, all-scope only (the CHECKs above). The
-- starting grants, in each role's template too (RAD-83).
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, 'gst:returns', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, 'gst:returns', 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- A view is read, never written (as v_document_paid).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.gst_outward_lines FROM radcore_app;
