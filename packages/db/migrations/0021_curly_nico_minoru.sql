CREATE TABLE "advertiser_credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"description" text NOT NULL,
	"net_minor" integer NOT NULL,
	"tax_rate_bps" integer DEFAULT 2000 NOT NULL,
	"tax_minor" integer NOT NULL,
	"gross_minor" integer NOT NULL,
	"tax_code" text DEFAULT 'standard_vat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertiser_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"issuer_organisation_id" uuid NOT NULL,
	"credit_note_number" text NOT NULL,
	"reason" text NOT NULL,
	"issued_by_user_id" uuid,
	"issued_date" date NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertiser_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"booking_item_id" uuid,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"net_minor" integer NOT NULL,
	"tax_rate_bps" integer DEFAULT 2000 NOT NULL,
	"tax_minor" integer NOT NULL,
	"gross_minor" integer NOT NULL,
	"tax_code" text DEFAULT 'standard_vat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertiser_invoice_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_organisation_id" uuid NOT NULL,
	"key" text DEFAULT 'default' NOT NULL,
	"prefix" text DEFAULT 'INV' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertiser_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_organisation_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"customer_organisation_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"booking_id" uuid,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" date,
	"due_date" date,
	"voided_at" date,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"amount_paid_minor" integer DEFAULT 0 NOT NULL,
	"balance_minor" integer DEFAULT 0 NOT NULL,
	"billing_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_terms_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertiser_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"allocated_at" date NOT NULL,
	"status" text DEFAULT 'allocated' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertiser_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_organisation_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"payer_organisation_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"allocated_minor" integer DEFAULT 0 NOT NULL,
	"unallocated_minor" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"received_date" date NOT NULL,
	"method" text NOT NULL,
	"provider_key" text,
	"external_reference" text,
	"provider_event_id" text,
	"status" text DEFAULT 'received' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertiser_provider_sync_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_type" text NOT NULL,
	"provider_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"provider_entity_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_synced_at" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advertiser_credit_note_lines" ADD CONSTRAINT "advertiser_credit_note_lines_credit_note_id_advertiser_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."advertiser_credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_credit_note_lines" ADD CONSTRAINT "advertiser_credit_note_lines_invoice_line_id_advertiser_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."advertiser_invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_credit_notes" ADD CONSTRAINT "advertiser_credit_notes_invoice_id_advertiser_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."advertiser_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_credit_notes" ADD CONSTRAINT "advertiser_credit_notes_issuer_organisation_id_organisations_id_fk" FOREIGN KEY ("issuer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_credit_notes" ADD CONSTRAINT "advertiser_credit_notes_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_invoice_lines" ADD CONSTRAINT "advertiser_invoice_lines_invoice_id_advertiser_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."advertiser_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_invoice_lines" ADD CONSTRAINT "advertiser_invoice_lines_booking_item_id_commercial_booking_items_id_fk" FOREIGN KEY ("booking_item_id") REFERENCES "public"."commercial_booking_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_invoice_lines" ADD CONSTRAINT "advertiser_invoice_lines_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_invoice_sequences" ADD CONSTRAINT "advertiser_invoice_sequences_issuer_organisation_id_organisations_id_fk" FOREIGN KEY ("issuer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_invoices" ADD CONSTRAINT "advertiser_invoices_issuer_organisation_id_organisations_id_fk" FOREIGN KEY ("issuer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_invoices" ADD CONSTRAINT "advertiser_invoices_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_invoices" ADD CONSTRAINT "advertiser_invoices_customer_organisation_id_organisations_id_fk" FOREIGN KEY ("customer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_invoices" ADD CONSTRAINT "advertiser_invoices_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_invoices" ADD CONSTRAINT "advertiser_invoices_booking_id_commercial_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."commercial_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_payment_allocations" ADD CONSTRAINT "advertiser_payment_allocations_payment_id_advertiser_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."advertiser_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_payment_allocations" ADD CONSTRAINT "advertiser_payment_allocations_invoice_id_advertiser_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."advertiser_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_payments" ADD CONSTRAINT "advertiser_payments_issuer_organisation_id_organisations_id_fk" FOREIGN KEY ("issuer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_payments" ADD CONSTRAINT "advertiser_payments_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_payments" ADD CONSTRAINT "advertiser_payments_payer_organisation_id_organisations_id_fk" FOREIGN KEY ("payer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertiser_credit_note_lines_credit_note_id_idx" ON "advertiser_credit_note_lines" USING btree ("credit_note_id");--> statement-breakpoint
CREATE INDEX "advertiser_credit_note_lines_deleted_at_idx" ON "advertiser_credit_note_lines" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_credit_notes_issuer_number_uidx" ON "advertiser_credit_notes" USING btree ("issuer_organisation_id","credit_note_number");--> statement-breakpoint
CREATE INDEX "advertiser_credit_notes_invoice_id_idx" ON "advertiser_credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "advertiser_credit_notes_deleted_at_idx" ON "advertiser_credit_notes" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "advertiser_invoice_lines_invoice_id_idx" ON "advertiser_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "advertiser_invoice_lines_booking_item_id_idx" ON "advertiser_invoice_lines" USING btree ("booking_item_id");--> statement-breakpoint
CREATE INDEX "advertiser_invoice_lines_deleted_at_idx" ON "advertiser_invoice_lines" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_invoice_sequences_issuer_key_uidx" ON "advertiser_invoice_sequences" USING btree ("issuer_organisation_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_invoices_issuer_number_uidx" ON "advertiser_invoices" USING btree ("issuer_organisation_id","invoice_number");--> statement-breakpoint
CREATE INDEX "advertiser_invoices_advertiser_id_idx" ON "advertiser_invoices" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "advertiser_invoices_territory_id_idx" ON "advertiser_invoices" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "advertiser_invoices_status_idx" ON "advertiser_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "advertiser_invoices_due_date_idx" ON "advertiser_invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "advertiser_invoices_deleted_at_idx" ON "advertiser_invoices" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "advertiser_payment_allocations_payment_id_idx" ON "advertiser_payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "advertiser_payment_allocations_invoice_id_idx" ON "advertiser_payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "advertiser_payment_allocations_deleted_at_idx" ON "advertiser_payment_allocations" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_payments_provider_event_uidx" ON "advertiser_payments" USING btree ("provider_key","provider_event_id");--> statement-breakpoint
CREATE INDEX "advertiser_payments_advertiser_id_idx" ON "advertiser_payments" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "advertiser_payments_issuer_idx" ON "advertiser_payments" USING btree ("issuer_organisation_id");--> statement-breakpoint
CREATE INDEX "advertiser_payments_deleted_at_idx" ON "advertiser_payments" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_provider_sync_entity_uidx" ON "advertiser_provider_sync_references" USING btree ("provider_type","provider_key","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "advertiser_provider_sync_status_idx" ON "advertiser_provider_sync_references" USING btree ("status");