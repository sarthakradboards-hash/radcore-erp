CREATE TABLE "radcore"."credit_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_table" text NOT NULL,
	"credit_id" uuid NOT NULL,
	"document_table" text NOT NULL,
	"document_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reverses_id" uuid,
	"reverses_direction" text GENERATED ALWAYS AS (case when reverses_id is not null then 'apply' end) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ux_credit_applications_reverses" UNIQUE("reverses_id"),
	CONSTRAINT "ux_credit_applications_key" UNIQUE("id","credit_table","credit_id","document_table","document_id","amount","direction"),
	CONSTRAINT "ck_credit_applications_amount" CHECK ("radcore"."credit_applications"."amount" >= 0 and "radcore"."credit_applications"."amount" <> 'NaN'),
	CONSTRAINT "ck_credit_applications_direction" CHECK ("radcore"."credit_applications"."direction" in ('apply', 'reverse')),
	CONSTRAINT "ck_credit_applications_positive" CHECK ("radcore"."credit_applications"."amount" > 0),
	CONSTRAINT "ck_credit_applications_reverse" CHECK (("radcore"."credit_applications"."direction" = 'reverse') = ("radcore"."credit_applications"."reverses_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "radcore"."payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"document_table" text NOT NULL,
	"document_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reverses_id" uuid,
	"reverses_direction" text GENERATED ALWAYS AS (case when reverses_id is not null then 'apply' end) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
	CONSTRAINT "ux_payment_allocations_reverses" UNIQUE("reverses_id"),
	CONSTRAINT "ux_payment_allocations_key" UNIQUE("id","document_table","document_id","payment_id","amount","direction"),
	CONSTRAINT "ck_payment_allocations_amount" CHECK ("radcore"."payment_allocations"."amount" >= 0 and "radcore"."payment_allocations"."amount" <> 'NaN'),
	CONSTRAINT "ck_payment_allocations_direction" CHECK ("radcore"."payment_allocations"."direction" in ('apply', 'reverse')),
	CONSTRAINT "ck_payment_allocations_positive" CHECK ("radcore"."payment_allocations"."amount" > 0),
	CONSTRAINT "ck_payment_allocations_reverse" CHECK (("radcore"."payment_allocations"."direction" = 'reverse') = ("radcore"."payment_allocations"."reverses_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "radcore"."credit_applications" ADD CONSTRAINT "fk_credit_applications_reverses" FOREIGN KEY ("reverses_id","credit_table","credit_id","document_table","document_id","amount","reverses_direction") REFERENCES "radcore"."credit_applications"("id","credit_table","credit_id","document_table","document_id","amount","direction") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "radcore"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radcore"."payment_allocations" ADD CONSTRAINT "fk_payment_allocations_reverses" FOREIGN KEY ("reverses_id","document_table","document_id","payment_id","amount","reverses_direction") REFERENCES "radcore"."payment_allocations"("id","document_table","document_id","payment_id","amount","direction") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_credit_applications_credit" ON "radcore"."credit_applications" USING btree ("credit_table","credit_id");--> statement-breakpoint
CREATE INDEX "ix_credit_applications_document" ON "radcore"."credit_applications" USING btree ("document_table","document_id");--> statement-breakpoint
CREATE INDEX "ix_credit_applications_reverses" ON "radcore"."credit_applications" USING btree ("reverses_id","credit_table","credit_id","document_table","document_id","amount","reverses_direction");--> statement-breakpoint
CREATE INDEX "ix_payment_allocations_payment" ON "radcore"."payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "ix_payment_allocations_document" ON "radcore"."payment_allocations" USING btree ("document_table","document_id");--> statement-breakpoint
CREATE INDEX "ix_payment_allocations_reverses" ON "radcore"."payment_allocations" USING btree ("reverses_id","document_table","document_id","payment_id","amount","reverses_direction");--> statement-breakpoint
CREATE VIEW "radcore"."v_document_paid" AS (select document_table, document_id, sum(allocated) as allocated, sum(credited) as credited,
    sum(allocated + credited) as paid
  from (select a.document_table, a.document_id, case a.direction when 'apply' then a.amount else -a.amount end as allocated,
      0::numeric as credited
    from radcore.payment_allocations a
    union all
    select c.document_table, c.document_id, 0::numeric, case c.direction when 'apply' then c.amount else -c.amount end
    from radcore.credit_applications c) as m
  group by document_table, document_id);--> statement-breakpoint
-- RAD-116 part 2 (M3-12; ADR-005 §7a, the architect's ruling): what an allocation may name. Each document's own
-- migration adds its row: its side (receivable or payable) and kind (charge, an invoice or bill; credit, a credit or
-- debit note). Hand-written like state_transitions, read only by the triggers below; it starts empty. Every table it
-- lists carries id, party_id, status and total, the amount the document posts to the party's line.
CREATE TABLE radcore.allocatable_documents (
  document_table text NOT NULL,
  side text NOT NULL,
  kind text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by text DEFAULT nullif(current_setting('app.principal', true), '') NOT NULL,
  CONSTRAINT pk_allocatable_documents PRIMARY KEY (document_table),
  CONSTRAINT ck_allocatable_documents_table CHECK (document_table ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT ck_allocatable_documents_side CHECK (side in ('receivable', 'payable')),
  CONSTRAINT ck_allocatable_documents_kind CHECK (kind in ('charge', 'credit'))
);
--> statement-breakpoint
SELECT radcore.audit_attach('allocatable_documents', keep => array['document_table', 'side', 'kind']);
--> statement-breakpoint
REVOKE ALL ON radcore.allocatable_documents FROM radcore_app;
--> statement-breakpoint
ALTER TABLE radcore.payment_allocations ADD CONSTRAINT fk_payment_allocations_document_table
  FOREIGN KEY (document_table) REFERENCES radcore.allocatable_documents (document_table) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE radcore.credit_applications ADD CONSTRAINT fk_credit_applications_credit_table
  FOREIGN KEY (credit_table) REFERENCES radcore.allocatable_documents (document_table) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE radcore.credit_applications ADD CONSTRAINT fk_credit_applications_document_table
  FOREIGN KEY (document_table) REFERENCES radcore.allocatable_documents (document_table) ON DELETE RESTRICT;
--> statement-breakpoint
-- Ledgers: append-only, a mistake undone by a reverse row, never an edit (ADR-005 §7a). Audited in full.
SELECT radcore.audit_attach('payment_allocations', keep => array['payment_id', 'document_table', 'document_id', 'direction', 'amount',
  'reverses_id', 'reverses_direction']);
--> statement-breakpoint
SELECT radcore.audit_attach('credit_applications', keep => array['credit_table', 'credit_id', 'document_table', 'document_id', 'direction',
  'amount', 'reverses_id', 'reverses_direction']);
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.payment_allocations FROM radcore_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON radcore.credit_applications FROM radcore_app;
--> statement-breakpoint
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.payment_allocations FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.payment_allocations FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_change BEFORE UPDATE OR DELETE ON radcore.credit_applications FOR EACH ROW EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
CREATE TRIGGER refuse_truncate BEFORE TRUNCATE ON radcore.credit_applications FOR EACH STATEMENT EXECUTE FUNCTION radcore.refuse_change();
--> statement-breakpoint
-- A registered document's party, status and total, its row locked. The table name comes from the registry, so the
-- format() is safe.
CREATE FUNCTION radcore.lock_allocatable(document_table text, document_id uuid, OUT party_id uuid, OUT status text, OUT total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM radcore.allocatable_documents d WHERE d.document_table = lock_allocatable.document_table) THEN
    RAISE EXCEPTION '% isn''t a document payments apply to', lock_allocatable.document_table USING ERRCODE = 'RA006';
  END IF;
  EXECUTE format('SELECT party_id, status, total FROM radcore.%I WHERE id = $1 FOR UPDATE', lock_allocatable.document_table)
    INTO party_id, status, total USING document_id;
  IF party_id IS NULL THEN
    RAISE EXCEPTION 'there''s no % %', lock_allocatable.document_table, document_id USING ERRCODE = 'RA006';
  END IF;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.lock_allocatable(text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- What has been applied to a document: its net allocations plus its net credit applications.
CREATE FUNCTION radcore.document_applied(document_table text, document_id uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
  SELECT coalesce((SELECT sum(CASE a.direction WHEN 'apply' THEN a.amount ELSE -a.amount END) FROM radcore.payment_allocations a
                   WHERE a.document_table = $1 AND a.document_id = $2), 0)
       + coalesce((SELECT sum(CASE c.direction WHEN 'apply' THEN c.amount ELSE -c.amount END) FROM radcore.credit_applications c
                   WHERE c.document_table = $1 AND c.document_id = $2), 0)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.document_applied(text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- The caps, at commit (RA006): the payment's row and the document's, locked in id order, then summed. A receipt applies
-- to a receivable charge, a payment to a payable charge, one party's; an apply needs both posted. The document's net
-- applied stays within its total; the payment's net allocations and its posted refunds within its amount, gross of
-- TDS held back (F8).
CREATE FUNCTION radcore.check_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  pay radcore.payments%ROWTYPE;
  doc record;
  reg radcore.allocatable_documents%ROWTYPE;
  used numeric;
  wanted text;
BEGIN
  IF NEW.payment_id < NEW.document_id THEN
    SELECT * INTO pay FROM radcore.payments WHERE id = NEW.payment_id FOR UPDATE;
    SELECT * INTO doc FROM radcore.lock_allocatable(NEW.document_table, NEW.document_id);
  ELSE
    SELECT * INTO doc FROM radcore.lock_allocatable(NEW.document_table, NEW.document_id);
    SELECT * INTO pay FROM radcore.payments WHERE id = NEW.payment_id FOR UPDATE;
  END IF;
  SELECT * INTO reg FROM radcore.allocatable_documents WHERE document_table = NEW.document_table;
  -- Worked out first: an IF's condition ends at its first THEN, a CASE's included.
  wanted := CASE pay.kind WHEN 'receipt' THEN 'receivable' ELSE 'payable' END;
  IF pay.kind = 'refund' OR reg.kind <> 'charge' OR reg.side <> wanted THEN
    RAISE EXCEPTION 'a receipt applies to a receivable charge and a payment to a payable charge' USING ERRCODE = 'RA006';
  END IF;
  IF doc.party_id <> pay.party_id THEN
    RAISE EXCEPTION 'a payment applies to its own party''s document' USING ERRCODE = 'RA006';
  END IF;
  IF NEW.direction = 'apply' AND (pay.status <> 'posted' OR doc.status <> 'posted') THEN
    RAISE EXCEPTION 'a payment applies, posted, to a posted document' USING ERRCODE = 'RA006';
  END IF;
  IF radcore.document_applied(NEW.document_table, NEW.document_id) > doc.total THEN
    RAISE EXCEPTION '% % would be paid past its total', NEW.document_table, NEW.document_id USING ERRCODE = 'RA006';
  END IF;
  SELECT coalesce(sum(CASE direction WHEN 'apply' THEN amount ELSE -amount END), 0) INTO used
    FROM radcore.payment_allocations WHERE payment_id = NEW.payment_id;
  used := used + coalesce((SELECT sum(amount) FROM radcore.payments WHERE refund_of_id = NEW.payment_id AND status = 'posted'), 0);
  IF used > pay.amount THEN
    RAISE EXCEPTION 'payment % would apply past its amount', pay.number USING ERRCODE = 'RA006';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.check_allocation() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER check_allocation AFTER INSERT ON radcore.payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION radcore.check_allocation();
--> statement-breakpoint
-- A credit taken to a charge on the same side, one party's (RA006): both rows locked in id order, then summed. An
-- apply needs both posted; the charge's net applied stays within its total, the credit's net applications within its.
CREATE FUNCTION radcore.check_credit_application() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  credit record;
  doc record;
  credit_reg radcore.allocatable_documents%ROWTYPE;
  doc_reg radcore.allocatable_documents%ROWTYPE;
  used numeric;
BEGIN
  IF NEW.credit_id < NEW.document_id THEN
    SELECT * INTO credit FROM radcore.lock_allocatable(NEW.credit_table, NEW.credit_id);
    SELECT * INTO doc FROM radcore.lock_allocatable(NEW.document_table, NEW.document_id);
  ELSE
    SELECT * INTO doc FROM radcore.lock_allocatable(NEW.document_table, NEW.document_id);
    SELECT * INTO credit FROM radcore.lock_allocatable(NEW.credit_table, NEW.credit_id);
  END IF;
  SELECT * INTO credit_reg FROM radcore.allocatable_documents WHERE document_table = NEW.credit_table;
  SELECT * INTO doc_reg FROM radcore.allocatable_documents WHERE document_table = NEW.document_table;
  IF credit_reg.kind <> 'credit' OR doc_reg.kind <> 'charge' OR credit_reg.side <> doc_reg.side THEN
    RAISE EXCEPTION 'a credit applies to a charge on the same side' USING ERRCODE = 'RA006';
  END IF;
  IF credit.party_id <> doc.party_id THEN
    RAISE EXCEPTION 'a credit applies to its own party''s document' USING ERRCODE = 'RA006';
  END IF;
  IF NEW.direction = 'apply' AND (credit.status <> 'posted' OR doc.status <> 'posted') THEN
    RAISE EXCEPTION 'a credit applies, posted, to a posted document' USING ERRCODE = 'RA006';
  END IF;
  IF radcore.document_applied(NEW.document_table, NEW.document_id) > doc.total THEN
    RAISE EXCEPTION '% % would be paid past its total', NEW.document_table, NEW.document_id USING ERRCODE = 'RA006';
  END IF;
  SELECT coalesce(sum(CASE direction WHEN 'apply' THEN amount ELSE -amount END), 0) INTO used
    FROM radcore.credit_applications WHERE credit_table = NEW.credit_table AND credit_id = NEW.credit_id;
  IF used > credit.total THEN
    RAISE EXCEPTION '% % would apply past its total', NEW.credit_table, NEW.credit_id USING ERRCODE = 'RA006';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.check_credit_application() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER check_credit_application AFTER INSERT ON radcore.credit_applications
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION radcore.check_credit_application();
--> statement-breakpoint
-- A posted payment is cancelled only once its net allocations are zero (ADR-005 §7a): reverse them first.
CREATE FUNCTION radcore.guard_payment_cancel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND coalesce((SELECT sum(CASE direction WHEN 'apply' THEN amount ELSE -amount END)
      FROM radcore.payment_allocations WHERE payment_id = NEW.id), 0) <> 0 THEN
    RAISE EXCEPTION 'payment % is still applied to documents: reverse its allocations first', OLD.number USING ERRCODE = 'RA006';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.guard_payment_cancel() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_payment_cancel BEFORE UPDATE OF status ON radcore.payments FOR EACH ROW EXECUTE FUNCTION radcore.guard_payment_cancel();
--> statement-breakpoint
-- RAD-24's rule for a view's migration: no writing through a view, since a simple view writes as its owner.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON radcore.v_document_paid FROM radcore_app;
