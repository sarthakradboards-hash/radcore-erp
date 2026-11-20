ALTER TABLE "radcore"."payments" DROP CONSTRAINT "ck_payments_refund";--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD COLUMN "credit_table" text;--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD COLUMN "credit_id" uuid;--> statement-breakpoint
CREATE INDEX "ix_payments_credit" ON "radcore"."payments" USING btree ("credit_table","credit_id");--> statement-breakpoint
ALTER TABLE "radcore"."payments" ADD CONSTRAINT "ck_payments_refund" CHECK (("radcore"."payments"."kind" = 'refund') = ("radcore"."payments"."refund_of_id" is not null or "radcore"."payments"."credit_table" is not null)
    and ("radcore"."payments"."refund_of_id" is null or "radcore"."payments"."credit_table" is null) and ("radcore"."payments"."credit_table" is null) = ("radcore"."payments"."credit_id" is null)
    and ("radcore"."payments"."kind" <> 'refund' or "radcore"."payments"."tds" = 0));--> statement-breakpoint
-- A refund may name a credit (a credit note) instead of a receipt (RAD-114, the architect's ruling; ADR-007 §6, ADR-005
-- §7a): the pair names a registered document, as a credit application's does.
ALTER TABLE radcore.payments ADD CONSTRAINT fk_payments_credit_table
  FOREIGN KEY (credit_table) REFERENCES radcore.allocatable_documents (document_table) ON DELETE RESTRICT;
--> statement-breakpoint
SELECT radcore.audit_attach('payments', keep => array['kind', 'status', 'number', 'party_id', 'business_date', 'amount', 'tds',
  'account_id', 'refund_of_id', 'credit_table', 'credit_id', 'narration', 'held_for_table', 'held_for_id', 'posted_entry_id',
  'cancelled_at', 'cancelled_by', 'cancel_reason', 'cancel_entry_id']);
--> statement-breakpoint
-- What a credit has used: its net applications and the posted refunds that name it (ADR-005 §7a).
CREATE FUNCTION radcore.credit_used(credit_table text, credit_id uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
  SELECT coalesce((SELECT sum(CASE c.direction WHEN 'apply' THEN c.amount ELSE -c.amount END) FROM radcore.credit_applications c
                   WHERE c.credit_table = $1 AND c.credit_id = $2), 0)
       + coalesce((SELECT sum(p.amount) FROM radcore.payments p
                   WHERE p.credit_table = $1 AND p.credit_id = $2 AND p.status = 'posted'), 0)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.credit_used(text, uuid) FROM PUBLIC;
--> statement-breakpoint
-- A credit's applications and its refunds share its total, so the application's cap counts both: the two lock the
-- credit's row first, so they take turns.
CREATE OR REPLACE FUNCTION radcore.check_credit_application() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  credit record;
  doc record;
  credit_reg radcore.allocatable_documents%ROWTYPE;
  doc_reg radcore.allocatable_documents%ROWTYPE;
BEGIN
  SELECT * INTO credit FROM radcore.lock_allocatable(NEW.credit_table, NEW.credit_id);
  SELECT * INTO doc FROM radcore.lock_allocatable(NEW.document_table, NEW.document_id);
  SELECT * INTO credit_reg FROM radcore.allocatable_documents WHERE document_table = NEW.credit_table;
  SELECT * INTO doc_reg FROM radcore.allocatable_documents WHERE document_table = NEW.document_table;
  IF credit_reg.kind <> 'credit' OR doc_reg.kind <> 'charge' OR credit_reg.side <> doc_reg.side THEN
    RAISE EXCEPTION 'a credit applies to a charge on the same side' USING ERRCODE = 'RA006', CONSTRAINT = 'credit_application_side_mismatch';
  END IF;
  IF credit.party_id <> doc.party_id THEN
    RAISE EXCEPTION 'a credit applies to its own party''s document' USING ERRCODE = 'RA006', CONSTRAINT = 'credit_application_party_mismatch';
  END IF;
  IF NEW.direction = 'apply' AND (credit.status <> 'posted' OR doc.status <> 'posted') THEN
    RAISE EXCEPTION 'a credit applies, posted, to a posted document'
      USING ERRCODE = 'RA006', CONSTRAINT = 'credit_application_document_not_posted';
  END IF;
  IF NEW.business_date < greatest(credit.business_date, doc.business_date) THEN
    RAISE EXCEPTION 'a credit application is dated on or after both its credit and its charge'
      USING ERRCODE = 'RA006', CONSTRAINT = 'credit_application_before_source';
  END IF;
  IF radcore.document_applied(NEW.document_table, NEW.document_id) > doc.total THEN
    RAISE EXCEPTION '% % would be paid past its total', NEW.document_table, NEW.document_id
      USING ERRCODE = 'RA006', CONSTRAINT = 'credit_application_exceeds_document';
  END IF;
  IF radcore.credit_used(NEW.credit_table, NEW.credit_id) > credit.total THEN
    RAISE EXCEPTION '% % would apply past its total', NEW.credit_table, NEW.credit_id
      USING ERRCODE = 'RA006', CONSTRAINT = 'credit_application_exceeds_credit';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- A registered document is cancelled only when nothing is applied to it or from it, a refund naming it included.
CREATE OR REPLACE FUNCTION radcore.guard_applied_cancel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
     AND (radcore.document_applied(TG_TABLE_NAME, NEW.id) <> 0 OR radcore.credit_used(TG_TABLE_NAME, NEW.id) <> 0) THEN
    RAISE EXCEPTION '% % still has payments, credits or refunds against it: reverse them first', TG_TABLE_NAME, NEW.id
      USING ERRCODE = 'RA006', CONSTRAINT = 'document_still_applied';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- A refund of a credit (RAD-114, the architect's rulings): the credit's row is locked when the refund is written,
-- before the cash limit takes the party (ADR-006 §1: documents at step 2, the party at step 3), and again when it
-- posts, whoever posts it (an approval too). Under that lock, each rule by name (ADR-005 §9): a receivable credit,
-- posted, of the refund's party, and dated on or before the refund. The cap is checked at commit, below. A table not
-- in the registry is left to the foreign key, refused by name too.
CREATE FUNCTION radcore.check_credit_refund() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  credit record;
  reg radcore.allocatable_documents%ROWTYPE;
BEGIN
  SELECT * INTO reg FROM radcore.allocatable_documents WHERE document_table = NEW.credit_table;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT * INTO credit FROM radcore.lock_allocatable(NEW.credit_table, NEW.credit_id);
  IF TG_OP = 'UPDATE' AND (NEW.status <> 'posted' OR OLD.status = 'posted') THEN
    RETURN NEW;
  END IF;
  IF reg.kind <> 'credit' OR reg.side <> 'receivable' THEN
    RAISE EXCEPTION 'a refund pays a customer back: it names a credit note' USING ERRCODE = 'RA006', CONSTRAINT = 'refund_credit_side_mismatch';
  END IF;
  IF credit.status <> 'posted' THEN
    RAISE EXCEPTION 'a refund names a posted credit' USING ERRCODE = 'RA006', CONSTRAINT = 'refund_credit_not_posted';
  END IF;
  IF credit.party_id <> NEW.party_id THEN
    RAISE EXCEPTION 'a refund goes to its credit''s party' USING ERRCODE = 'RA006', CONSTRAINT = 'refund_credit_party_mismatch';
  END IF;
  IF NEW.business_date < credit.business_date THEN
    RAISE EXCEPTION 'a refund is dated on or after its credit' USING ERRCODE = 'RA006', CONSTRAINT = 'refund_credit_before_source';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.check_credit_refund() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER check_credit_refund BEFORE INSERT OR UPDATE OF status ON radcore.payments
  FOR EACH ROW WHEN (NEW.credit_table IS NOT NULL) EXECUTE FUNCTION radcore.check_credit_refund();
--> statement-breakpoint
-- The cap, at commit, as a credit application's is (ADR-005 §7a): a posted refund's credit, locked, keeps its
-- applications and posted refunds within its total.
CREATE FUNCTION radcore.check_credit_refund_cap() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
DECLARE
  credit record;
BEGIN
  SELECT * INTO credit FROM radcore.lock_allocatable(NEW.credit_table, NEW.credit_id);
  IF radcore.credit_used(NEW.credit_table, NEW.credit_id) > credit.total THEN
    RAISE EXCEPTION '% % would be refunded past its total', NEW.credit_table, NEW.credit_id
      USING ERRCODE = 'RA006', CONSTRAINT = 'refund_exceeds_credit';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.check_credit_refund_cap() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER check_credit_refund_cap AFTER INSERT OR UPDATE OF status ON radcore.payments DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.credit_table IS NOT NULL AND NEW.status = 'posted') EXECUTE FUNCTION radcore.check_credit_refund_cap();
