CREATE TABLE "radcore"."invoice_amendments" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"old_gstin" text NOT NULL,
	"new_gstin" text NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "ck_invoice_amendments_old_gstin" CHECK (char_length("radcore"."invoice_amendments"."old_gstin") <= 15),
	CONSTRAINT "ck_invoice_amendments_new_gstin" CHECK (char_length("radcore"."invoice_amendments"."new_gstin") <= 15),
	CONSTRAINT "ck_invoice_amendments_reason" CHECK (char_length("radcore"."invoice_amendments"."reason") <= 500),
	CONSTRAINT "ck_invoice_amendments_same_state" CHECK ("radcore"."invoice_amendments"."new_gstin" <> "radcore"."invoice_amendments"."old_gstin" and left("radcore"."invoice_amendments"."new_gstin", 2) = left("radcore"."invoice_amendments"."old_gstin", 2))
);
--> statement-breakpoint
ALTER TABLE "radcore"."invoice_amendments" ADD CONSTRAINT "invoice_amendments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "radcore"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_invoice_amendments_invoice" ON "radcore"."invoice_amendments" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_invoice_amendments_date" ON "radcore"."invoice_amendments" USING btree ("business_date");--> statement-breakpoint
-- Never changed or deleted (ADR-010 §5): a wrong amendment is amended again.
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.invoice_amendments FROM radcore_app;--> statement-breakpoint
SELECT radcore.audit_attach('invoice_amendments', keep => array['invoice_id', 'business_date', 'old_gstin', 'new_gstin', 'reason']);
