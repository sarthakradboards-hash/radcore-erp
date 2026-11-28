CREATE TABLE "radcore"."payment_tds" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"expected" numeric(18, 2),
	CONSTRAINT "ck_payment_tds_expected" CHECK ("radcore"."payment_tds"."expected" >= 0 and "radcore"."payment_tds"."expected" <> 'NaN')
);
--> statement-breakpoint
ALTER TABLE "radcore"."payment_tds" ADD CONSTRAINT "payment_tds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "radcore"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."payment_tds" ADD CONSTRAINT "payment_tds_section_id_tds_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "radcore"."tds_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_payment_tds_section" ON "radcore"."payment_tds" USING btree ("section_id");--> statement-breakpoint
-- RAD-158 (the architect's ruling 1, 28 Nov): payments' typed TDS is replaced by a section and its tds_deductions row.
-- No backfill: a database holding a payment made with typed TDS is reset, not migrated.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM radcore.payments WHERE kind = 'payment' AND tds > 0) THEN
    RAISE EXCEPTION 'payments with typed TDS exist; RAD-158 replaces them — reset this database';
  END IF;
END $$;
--> statement-breakpoint
SELECT radcore.audit_attach('payment_tds', keep => array['payment_id', 'section_id', 'expected'], owner => 'payment_id', owner_table => 'payments');
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.payment_tds FROM radcore_app;
