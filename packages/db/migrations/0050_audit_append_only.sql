-- The audit trail is append-only. Until now that was only a convention of the API; this makes the database refuse
-- any change or removal of a recorded event, for every role and every code path, including hand-run SQL.
CREATE FUNCTION "audit_events_append_only_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_events is append-only: % is not allowed.', TG_OP USING ERRCODE = 'check_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only_row_trg" BEFORE UPDATE OR DELETE ON "audit_events"
	FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only_guard"();--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only_truncate_trg" BEFORE TRUNCATE ON "audit_events"
	FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_append_only_guard"();--> statement-breakpoint
-- Lets a search by action prefix and a "newer than / older than" page walk stay fast as the trail grows.
CREATE INDEX "audit_events_action_created_idx" ON "audit_events" USING btree ("action" text_pattern_ops, "created_at" DESC);
