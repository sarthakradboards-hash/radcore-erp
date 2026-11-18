ALTER TABLE "radcore"."journal_entries" DROP CONSTRAINT "ck_journal_entries_manual";--> statement-breakpoint
ALTER TABLE "radcore"."journal_entries" ADD CONSTRAINT "ck_journal_entries_manual" CHECK ("radcore"."journal_entries"."kind" <> 'manual' or ("radcore"."journal_entries"."source_table" = 'journal_entries' and "radcore"."journal_entries"."reason" is not null
    and ("radcore"."journal_entries"."source_id" = "radcore"."journal_entries"."id" or "radcore"."journal_entries"."source_id" = "radcore"."journal_entries"."reverses_entry_id")));--> statement-breakpoint
-- The journal keys (RAD-86), ordinary catalogue keys any role can be given. The starting grants are in each role and
-- its template, so a reset keeps them (RAD-83): reading the chart and the journal, posting a manual journal and
-- reversing an entry, for admin, owner and accounts. Posting and reversing move money, so a role holding either needs
-- the second factor (D-19), as the catalogue marks them.
INSERT INTO radcore.role_grants (role, permission, scope)
SELECT r, k, 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r, unnest(array['journal:read', 'journal:post', 'journal:reverse']) AS k
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO radcore.role_templates (role, permission, scope)
SELECT r, k, 'all' FROM unnest(array['admin', 'owner', 'accounts']) AS r, unnest(array['journal:read', 'journal:post', 'journal:reverse']) AS k
ON CONFLICT DO NOTHING;
