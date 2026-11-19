ALTER TABLE "radcore"."price_list_versions" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
-- A version made before this migration takes the status its dates already say, before the CHECK holds the two equal.
UPDATE radcore.price_list_versions SET status = CASE WHEN superseded_from IS NOT NULL THEN 'superseded'
  WHEN in_force_from IS NOT NULL THEN 'approved' ELSE 'draft' END;--> statement-breakpoint
ALTER TABLE "radcore"."price_list_versions" ADD CONSTRAINT "ck_price_list_versions_status" CHECK ("radcore"."price_list_versions"."status" in ('draft', 'approved', 'superseded')
    and ("radcore"."price_list_versions"."status" = 'draft') = ("radcore"."price_list_versions"."in_force_from" is null) and ("radcore"."price_list_versions"."status" = 'superseded') = ("radcore"."price_list_versions"."superseded_from" is not null));
--> statement-breakpoint
-- The new column joins the audit's kept list (ADR-005 §5): a table that gains a column is attached again.
SELECT radcore.audit_attach('price_list_versions', keep => array['price_list_id', 'tax_inclusive', 'in_force_from', 'superseded_from', 'status']);
--> statement-breakpoint
-- The architect's MUST on RAD-98: an approved price version can't change in the database either, held the way posted
-- documents are (#185's generic guards, ADR-005 §7b). A version moves draft -> approved -> superseded, and nothing
-- else; while a draft, anything changes; after that, only its status, and superseded_from once. Its rates change only
-- while it's a draft.
INSERT INTO radcore.state_transitions (document_table, from_status, to_status) VALUES
  ('price_list_versions', 'draft', 'approved'), ('price_list_versions', 'approved', 'superseded');
--> statement-breakpoint
CREATE TRIGGER guard_posted_document BEFORE INSERT OR UPDATE OR DELETE ON radcore.price_list_versions
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_posted_document('draft', '', 'superseded_from');
--> statement-breakpoint
CREATE TRIGGER guard_document_line BEFORE INSERT OR UPDATE OR DELETE ON radcore.price_list_rates
  FOR EACH ROW EXECUTE FUNCTION radcore.guard_document_line('price_list_versions', 'version_id', 'draft');
