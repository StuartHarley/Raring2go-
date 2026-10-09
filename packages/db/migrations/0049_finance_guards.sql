-- Money rules the database itself enforces, so no code path (or hand-run SQL) can break them.
-- CHECKs are NOT VALID: they apply to every new and changed row now. Once any historical rows have been
-- reviewed, `ALTER TABLE ... VALIDATE CONSTRAINT ...` can be run for each.

ALTER TABLE "advertiser_invoices"
	ADD CONSTRAINT "advertiser_invoices_amounts_chk" CHECK (
		"subtotal_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" = "subtotal_minor" + "tax_minor"
		AND "amount_paid_minor" >= 0 AND "balance_minor" >= 0 AND "amount_paid_minor" + "balance_minor" <= "total_minor"
	) NOT VALID;--> statement-breakpoint
ALTER TABLE "advertiser_payments"
	ADD CONSTRAINT "advertiser_payments_amounts_chk" CHECK (
		"amount_minor" > 0 AND "allocated_minor" >= 0 AND "unallocated_minor" >= 0 AND "allocated_minor" + "unallocated_minor" = "amount_minor"
	) NOT VALID;--> statement-breakpoint
-- A provider payment with no provider event id could never be de-duplicated, so it is not allowed.
ALTER TABLE "advertiser_payments"
	ADD CONSTRAINT "advertiser_payments_provider_event_chk" CHECK ("provider_key" IS NULL OR "provider_event_id" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "advertiser_payment_allocations"
	ADD CONSTRAINT "advertiser_payment_allocations_amount_chk" CHECK ("amount_minor" > 0) NOT VALID;--> statement-breakpoint

-- Issued invoices: the commercial record is frozen. Only payment state (status, paid, balance) and voiding may change.
CREATE FUNCTION "advertiser_invoices_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD."status" <> 'draft' THEN
			RAISE EXCEPTION 'Issued invoices cannot be deleted; void them instead.' USING ERRCODE = 'check_violation';
		END IF;
		RETURN OLD;
	END IF;
	IF OLD."status" <> 'draft' THEN
		IF NEW."status" = 'draft'
			OR NEW."invoice_number" IS DISTINCT FROM OLD."invoice_number"
			OR NEW."issuer_organisation_id" IS DISTINCT FROM OLD."issuer_organisation_id"
			OR NEW."advertiser_id" IS DISTINCT FROM OLD."advertiser_id"
			OR NEW."customer_organisation_id" IS DISTINCT FROM OLD."customer_organisation_id"
			OR NEW."territory_id" IS DISTINCT FROM OLD."territory_id"
			OR NEW."booking_id" IS DISTINCT FROM OLD."booking_id"
			OR NEW."issue_date" IS DISTINCT FROM OLD."issue_date"
			OR NEW."due_date" IS DISTINCT FROM OLD."due_date"
			OR NEW."currency" IS DISTINCT FROM OLD."currency"
			OR NEW."subtotal_minor" IS DISTINCT FROM OLD."subtotal_minor"
			OR NEW."tax_minor" IS DISTINCT FROM OLD."tax_minor"
			OR NEW."total_minor" IS DISTINCT FROM OLD."total_minor"
			OR NEW."billing_snapshot" IS DISTINCT FROM OLD."billing_snapshot"
			OR NEW."payment_terms_snapshot" IS DISTINCT FROM OLD."payment_terms_snapshot"
			OR NEW."issued_snapshot" IS DISTINCT FROM OLD."issued_snapshot"
			OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at" THEN
			RAISE EXCEPTION 'An issued invoice cannot be changed. Credit or void it instead.' USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "advertiser_invoices_guard_trg" BEFORE UPDATE OR DELETE ON "advertiser_invoices"
	FOR EACH ROW EXECUTE FUNCTION "advertiser_invoices_guard"();--> statement-breakpoint

-- Lines of an issued invoice are frozen too. A line may be added while its invoice is being created, in the same
-- transaction, which is what `created_at = transaction start` identifies.
CREATE FUNCTION "advertiser_invoice_lines_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text; parent_created timestamptz; parent_id uuid;
BEGIN
	parent_id := COALESCE(NEW."invoice_id", OLD."invoice_id");
	SELECT "status", "created_at" INTO parent_status, parent_created FROM "advertiser_invoices" WHERE "id" = parent_id;
	IF parent_status IS NOT NULL AND parent_status <> 'draft' AND parent_created < transaction_timestamp() THEN
		RAISE EXCEPTION 'The lines of an issued invoice cannot be changed.' USING ERRCODE = 'check_violation';
	END IF;
	RETURN COALESCE(NEW, OLD);
END $$;--> statement-breakpoint
CREATE TRIGGER "advertiser_invoice_lines_guard_trg" BEFORE INSERT OR UPDATE OR DELETE ON "advertiser_invoice_lines"
	FOR EACH ROW EXECUTE FUNCTION "advertiser_invoice_lines_guard"();--> statement-breakpoint

-- Credit notes (and their lines) are append-only.
CREATE FUNCTION "advertiser_append_only_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION '% rows cannot be changed or deleted once written.', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;--> statement-breakpoint
CREATE TRIGGER "advertiser_credit_notes_guard_trg" BEFORE UPDATE OR DELETE ON "advertiser_credit_notes"
	FOR EACH ROW EXECUTE FUNCTION "advertiser_append_only_guard"();--> statement-breakpoint
CREATE TRIGGER "advertiser_credit_note_lines_guard_trg" BEFORE UPDATE OR DELETE ON "advertiser_credit_note_lines"
	FOR EACH ROW EXECUTE FUNCTION "advertiser_append_only_guard"();--> statement-breakpoint
CREATE TRIGGER "advertiser_payment_allocations_guard_trg" BEFORE DELETE ON "advertiser_payment_allocations"
	FOR EACH ROW EXECUTE FUNCTION "advertiser_append_only_guard"();--> statement-breakpoint

-- An accepted proposal acceptance is the legal record of what was agreed: terms, snapshot and who accepted are frozen.
-- Only attaching the booking it created (once) may change.
CREATE FUNCTION "advertiser_acceptances_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD."status" = 'accepted' THEN
			RAISE EXCEPTION 'An accepted proposal acceptance cannot be deleted.' USING ERRCODE = 'check_violation';
		END IF;
		RETURN OLD;
	END IF;
	IF OLD."status" = 'accepted' THEN
		IF NEW."status" IS DISTINCT FROM OLD."status"
			OR NEW."proposal_id" IS DISTINCT FROM OLD."proposal_id"
			OR NEW."advertiser_id" IS DISTINCT FROM OLD."advertiser_id"
			OR NEW."territory_id" IS DISTINCT FROM OLD."territory_id"
			OR NEW."terms_id" IS DISTINCT FROM OLD."terms_id"
			OR NEW."method" IS DISTINCT FROM OLD."method"
			OR NEW."accepted_by_contact_id" IS DISTINCT FROM OLD."accepted_by_contact_id"
			OR NEW."accepted_at" IS DISTINCT FROM OLD."accepted_at"
			OR NEW."commercial_snapshot" IS DISTINCT FROM OLD."commercial_snapshot"
			OR NEW."request_metadata" IS DISTINCT FROM OLD."request_metadata"
			OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
			OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
			OR (OLD."booking_id" IS NOT NULL AND NEW."booking_id" IS DISTINCT FROM OLD."booking_id") THEN
			RAISE EXCEPTION 'An accepted proposal acceptance cannot be changed.' USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "advertiser_acceptances_guard_trg" BEFORE UPDATE OR DELETE ON "advertiser_proposal_acceptances"
	FOR EACH ROW EXECUTE FUNCTION "advertiser_acceptances_guard"();
