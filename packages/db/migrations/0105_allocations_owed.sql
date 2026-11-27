ALTER TABLE "radcore"."expenses" DROP CONSTRAINT "ck_expenses_owed";--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bills" ADD COLUMN "tds" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bills" ADD COLUMN "owed" numeric(18, 2) GENERATED ALWAYS AS (total - tds) STORED;--> statement-breakpoint
ALTER TABLE "radcore"."expenses" ADD COLUMN "tds" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bills" ADD CONSTRAINT "ck_purchase_bills_tds" CHECK ("radcore"."purchase_bills"."tds" >= 0 and "radcore"."purchase_bills"."tds" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bills" ADD CONSTRAINT "ck_purchase_bills_owed" CHECK ("radcore"."purchase_bills"."owed" >= 0 and "radcore"."purchase_bills"."owed" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."purchase_bills" ADD CONSTRAINT "ck_purchase_bills_tds_within" CHECK ("radcore"."purchase_bills"."total" is null and "radcore"."purchase_bills"."tds" = 0 or "radcore"."purchase_bills"."tds" <= "radcore"."purchase_bills"."total");--> statement-breakpoint
ALTER TABLE "radcore"."expenses" ADD CONSTRAINT "ck_expenses_tds" CHECK ("radcore"."expenses"."tds" >= 0 and "radcore"."expenses"."tds" <> 'NaN');--> statement-breakpoint
ALTER TABLE "radcore"."expenses" ADD CONSTRAINT "ck_expenses_owed" CHECK (("radcore"."expenses"."pay_from_account_id" is null and "radcore"."expenses"."party_id" is not null and "radcore"."expenses"."total" = "radcore"."expenses"."stated_total" - "radcore"."expenses"."tds")
    or ("radcore"."expenses"."pay_from_account_id" is not null and "radcore"."expenses"."total" = 0));--> statement-breakpoint
-- RAD-158 (the architect's ruling (a)): what a document owes its party is the amount payments and credits apply
-- against. A bill's `total` stays what the supplier's invoice says; it owes `owed`, the total less the TDS held back.
-- One place names that column per table, `total` unless said otherwise, and lock_allocatable reads it, so every cap
-- and every "open" figure reads the same amount.
ALTER TABLE radcore.allocatable_documents ADD COLUMN amount_column text NOT NULL DEFAULT 'total'
  CONSTRAINT ck_allocatable_documents_amount_column CHECK (amount_column ~ '^[a-z][a-z0-9_]*$');
--> statement-breakpoint
UPDATE radcore.allocatable_documents SET amount_column = 'owed' WHERE document_table = 'purchase_bills';
--> statement-breakpoint
SELECT radcore.audit_attach('allocatable_documents', keep => array['document_table', 'side', 'kind', 'amount_column']);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION radcore.lock_allocatable(document_table text, document_id uuid, OUT party_id uuid, OUT status text, OUT total numeric,
  OUT business_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  amount text;
BEGIN
  SELECT d.amount_column INTO amount FROM radcore.allocatable_documents d WHERE d.document_table = lock_allocatable.document_table;
  IF amount IS NULL THEN
    RAISE EXCEPTION '% isn''t a document payments apply to', lock_allocatable.document_table USING ERRCODE = 'RA006';
  END IF;
  EXECUTE format('SELECT party_id, status, %I, business_date FROM radcore.%I WHERE id = $1 FOR UPDATE', amount, lock_allocatable.document_table)
    INTO party_id, status, total, business_date USING document_id;
  IF party_id IS NULL THEN
    RAISE EXCEPTION 'there''s no % %', lock_allocatable.document_table, document_id
      USING ERRCODE = 'RA006', CONSTRAINT = 'allocatable_document_missing';
  END IF;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.lock_allocatable(text, uuid) FROM PUBLIC;
--> statement-breakpoint
SELECT radcore.audit_attach('purchase_bills', keep => array['number', 'party_id', 'business_date', 'status', 'supplier_invoice_number',
  'supplier_invoice_key', 'supplier_invoice_date', 'supplier_invoice_fy', 'supplier_gstin', 'stated_total', 'file_id', 'notes', 'place_of_supply', 'taxable', 'cgst', 'sgst', 'igst',
  'round_off', 'total', 'tds', 'owed', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
SELECT radcore.audit_attach('expenses', keep => array['number', 'business_date', 'party_id', 'supplier_invoice_number', 'supplier_invoice_date',
  'supplier_gstin', 'pay_from_account_id', 'status', 'stated_total', 'total', 'tds', 'file_id', 'notes', 'posted_entry_id', 'cancelled_at',
  'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
