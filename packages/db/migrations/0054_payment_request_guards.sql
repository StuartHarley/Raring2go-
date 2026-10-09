-- Money and state rules for online payment requests, enforced by the database itself.
ALTER TABLE "invoice_payment_requests"
	ADD CONSTRAINT "invoice_payment_requests_amount_chk" CHECK ("amount_minor" > 0);--> statement-breakpoint
ALTER TABLE "invoice_payment_requests"
	ADD CONSTRAINT "invoice_payment_requests_status_chk" CHECK ("status" IN ('open', 'paid', 'failed', 'expired', 'cancelled', 'refunded', 'disputed'));--> statement-breakpoint
ALTER TABLE "invoice_payment_requests"
	ADD CONSTRAINT "invoice_payment_requests_provider_chk" CHECK ("provider" IN ('stripe', 'gocardless'));--> statement-breakpoint
-- A paid request must say when and carry the provider's payment reference.
ALTER TABLE "invoice_payment_requests"
	ADD CONSTRAINT "invoice_payment_requests_paid_chk" CHECK ("status" <> 'paid' OR ("paid_at" IS NOT NULL AND "provider_payment_id" IS NOT NULL));
