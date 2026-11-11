-- RAD-31 (M1-13, RC-031): security events. Sign-in, a failed sign-in, a password or second-factor change, every
-- export and every download leave one event_log row, written only through record_event (ADR-005 §7c).
-- * user_id is the account the event concerns, which the principal can't say: a sign-in runs as system:public. It's
--   null when a failed sign-in's email matched nobody. No foreign key: the log outlives what it names.
-- * device is the short user-agent summary the sessions list shows ("Chrome on Android"); never an address.
-- * detail holds references only (M6-16): never a typed email, password, code or token. lib-platform checks each
--   kind's detail with its own schema first; the CHECKs here are the floor.
-- * Like record_access, record_event takes no principal and no time: they come from the request context and now().
ALTER TABLE radcore.event_log ADD COLUMN user_id uuid, ADD COLUMN device text;
--> statement-breakpoint
ALTER TABLE radcore.event_log
  ADD CONSTRAINT ck_event_log_kind CHECK (kind IN ('sign_in', 'sign_in_failed', 'password_changed',
    'second_factor_changed', 'export', 'download')),
  ADD CONSTRAINT ck_event_log_device CHECK (char_length(device) <= 80),
  ADD CONSTRAINT ck_event_log_detail CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 2048);
--> statement-breakpoint
-- listSecurityEvents reads newest first within a date range, optionally for one account.
CREATE INDEX ix_event_log_user_id ON radcore.event_log (user_id, occurred_at);
--> statement-breakpoint
CREATE FUNCTION radcore.record_event(kind text, user_id uuid, device text, detail jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, radcore, pg_temp AS $$
  INSERT INTO radcore.event_log (kind, user_id, device, detail) VALUES ($1, $2, $3, coalesce($4, '{}'));
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION radcore.record_event(text, uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION radcore.record_event(text, uuid, text, jsonb) TO radcore_app;
