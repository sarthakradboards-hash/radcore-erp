ALTER TABLE "radcore"."parties" ADD COLUMN "system_key" text;--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "radcore"."parties" ADD CONSTRAINT "parties_systemKey_unique" UNIQUE("system_key");--> statement-breakpoint
ALTER TABLE "radcore"."parties" ADD CONSTRAINT "ck_parties_system_key" CHECK ("radcore"."parties"."system_key" ~ '^[a-z][a-z0-9_]*$');--> statement-breakpoint
ALTER TABLE "radcore"."parties" ADD CONSTRAINT "ck_parties_system_active" CHECK ("radcore"."parties"."system_key" is null or "radcore"."parties"."active");--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD CONSTRAINT "ck_payments_reference" CHECK (char_length("radcore"."payments"."reference") <= 40);--> statement-breakpoint
-- The card machine's money lands here until it's moved to the bank, its fee as an expense, by a manual journal
-- (Sarthak, 22 Nov). Under Bank, so a receipt may use it as a money account; sales.card_account names it by default.
INSERT INTO radcore.accounts (system_key, name, type, control_kind, parent_id)
SELECT 'card_settlements', 'Card settlements', 'asset', 'none', id FROM radcore.accounts WHERE system_key = 'bank';
--> statement-breakpoint
-- The Counter customer (ADR-007 §7): a counter sale below sales.b2c_details_limit may go to it. Its state never decides
-- tax: it's the company's, set again whenever the profile is saved, and its quick bill's invoice is shipped to the shop.
INSERT INTO radcore.parties (system_key, name, customer, state_code)
SELECT 'walk_in', 'Counter customer', true, coalesce((SELECT state_code FROM radcore.company LIMIT 1), '27');
--> statement-breakpoint
-- The new columns join their tables' kept lists (ADR-005 §5): a table that gains a column is attached again.
SELECT radcore.audit_attach('parties',
  keep => array['name', 'customer', 'dealer', 'franchisee', 'supplier', 'gstin', 'pan', 'composition', 'state_code', 'credit_days', 'credit_limit', 'active',
    'system_key'],
  redact => array['phone', 'email', 'address_line1', 'address_line2', 'city', 'pincode']);
--> statement-breakpoint
SELECT radcore.audit_attach('payments', keep => array['kind', 'status', 'number', 'party_id', 'business_date', 'amount', 'tds',
  'account_id', 'refund_of_id', 'credit_table', 'credit_id', 'narration', 'held_for_table', 'held_for_id', 'posted_entry_id',
  'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id', 'reference']);
