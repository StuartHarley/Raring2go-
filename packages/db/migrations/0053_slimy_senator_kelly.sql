CREATE TABLE "invoice_payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"issuer_organisation_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_request_id" text NOT NULL,
	"provider_payment_id" text,
	"provider_account_id" text,
	"url" text,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"failure_reason" text,
	"idempotency_key" text NOT NULL,
	"requested_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_payment_requests" ADD CONSTRAINT "invoice_payment_requests_invoice_id_advertiser_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."advertiser_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_requests" ADD CONSTRAINT "invoice_payment_requests_issuer_organisation_id_organisations_id_fk" FOREIGN KEY ("issuer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_requests" ADD CONSTRAINT "invoice_payment_requests_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_requests" ADD CONSTRAINT "invoice_payment_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payment_requests_provider_request_uidx" ON "invoice_payment_requests" USING btree ("provider","provider_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payment_requests_idempotency_uidx" ON "invoice_payment_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payment_requests_one_open_uidx" ON "invoice_payment_requests" USING btree ("invoice_id","provider") WHERE "invoice_payment_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX "invoice_payment_requests_invoice_id_idx" ON "invoice_payment_requests" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payment_requests_payment_id_idx" ON "invoice_payment_requests" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "invoice_payment_requests_status_idx" ON "invoice_payment_requests" USING btree ("status");