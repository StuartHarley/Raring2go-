-- A published homepage template version is the record of what the public site showed, so it can never be edited or
-- deleted. The only change allowed is moving it to "retired" when a newer version is published.
CREATE FUNCTION "public_homepage_templates_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.status IN ('published', 'retired') THEN
			RAISE EXCEPTION 'A published homepage template version cannot be deleted.' USING ERRCODE = 'check_violation';
		END IF;
		RETURN OLD;
	END IF;
	IF OLD.status IN ('published', 'retired') THEN
		IF NEW.slots IS DISTINCT FROM OLD.slots OR NEW.version <> OLD.version OR NEW.key <> OLD.key OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
			RAISE EXCEPTION 'A published homepage template version cannot be changed; make a new version.' USING ERRCODE = 'check_violation';
		END IF;
		IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
			RAISE EXCEPTION 'A retired homepage template version cannot be revived; make a new version.' USING ERRCODE = 'check_violation';
		END IF;
		IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'retired') THEN
			RAISE EXCEPTION 'A published homepage template version can only be retired.' USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "public_homepage_templates_guard_trg" BEFORE UPDATE OR DELETE ON "public_homepage_templates"
	FOR EACH ROW EXECUTE FUNCTION "public_homepage_templates_guard"();
