ALTER TABLE "radcore"."stock_transfers" ADD COLUMN "requalified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "radcore"."stock_transfers" ADD COLUMN "condition" text;--> statement-breakpoint
ALTER TABLE "radcore"."stock_transfers" ADD CONSTRAINT "ck_stock_transfers_requalified" CHECK ("radcore"."stock_transfers"."requalified" = ("radcore"."stock_transfers"."condition" is not null) and coalesce("radcore"."stock_transfers"."condition", 'new') in ('new', 'used'));--> statement-breakpoint
-- RAD-137 (ADR-008 §9, the architect on RAD-137): a re-inspection is a stock transfer marked requalified, out of a
-- rejects place under inward:qc, with the condition its units were found in. Audited in full, as 0081 attached it,
-- with the two new columns kept.
SELECT radcore.audit_attach('stock_transfers', keep => array['status', 'number', 'from_id', 'to_id', 'requalified', 'condition',
  'business_date', 'reason', 'posted_entry_id', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
