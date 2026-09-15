CREATE TABLE "royalty_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "royalty_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_invoice_id" uuid,
	"source_payment_allocation_id" uuid,
	"description" text NOT NULL,
	"revenue_minor" integer NOT NULL,
	"royalty_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "royalty_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"revenue_basis" text DEFAULT 'collected' NOT NULL,
	"rate_bps" integer NOT NULL,
	"minimum_due_minor" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" date,
	"superseded_by_rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "royalty_statement_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuer_organisation_id" uuid NOT NULL,
	"key" text DEFAULT 'default' NOT NULL,
	"prefix" text DEFAULT 'ROY' NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "royalty_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"issuer_organisation_id" uuid NOT NULL,
	"royalty_rule_id" uuid NOT NULL,
	"statement_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"revenue_basis" text NOT NULL,
	"royalty_rate_bps_snapshot" integer NOT NULL,
	"gross_revenue_minor" integer DEFAULT 0 NOT NULL,
	"calculated_royalty_minor" integer DEFAULT 0 NOT NULL,
	"adjustments_minor" integer DEFAULT 0 NOT NULL,
	"total_due_minor" integer DEFAULT 0 NOT NULL,
	"generated_by_user_id" uuid,
	"generated_at" date NOT NULL,
	"submitted_at" date,
	"approved_by_user_id" uuid,
	"approved_at" date,
	"voided_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "royalty_adjustments" ADD CONSTRAINT "royalty_adjustments_statement_id_royalty_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."royalty_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_adjustments" ADD CONSTRAINT "royalty_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_lines" ADD CONSTRAINT "royalty_lines_statement_id_royalty_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."royalty_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_lines" ADD CONSTRAINT "royalty_lines_source_invoice_id_advertiser_invoices_id_fk" FOREIGN KEY ("source_invoice_id") REFERENCES "public"."advertiser_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_lines" ADD CONSTRAINT "royalty_lines_source_payment_allocation_id_advertiser_payment_allocations_id_fk" FOREIGN KEY ("source_payment_allocation_id") REFERENCES "public"."advertiser_payment_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_rules" ADD CONSTRAINT "royalty_rules_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_rules" ADD CONSTRAINT "royalty_rules_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_rules" ADD CONSTRAINT "royalty_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_rules" ADD CONSTRAINT "royalty_rules_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_statement_sequences" ADD CONSTRAINT "royalty_statement_sequences_issuer_organisation_id_organisations_id_fk" FOREIGN KEY ("issuer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_statements" ADD CONSTRAINT "royalty_statements_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_statements" ADD CONSTRAINT "royalty_statements_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_statements" ADD CONSTRAINT "royalty_statements_issuer_organisation_id_organisations_id_fk" FOREIGN KEY ("issuer_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_statements" ADD CONSTRAINT "royalty_statements_royalty_rule_id_royalty_rules_id_fk" FOREIGN KEY ("royalty_rule_id") REFERENCES "public"."royalty_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_statements" ADD CONSTRAINT "royalty_statements_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_statements" ADD CONSTRAINT "royalty_statements_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "royalty_adjustments_statement_id_idx" ON "royalty_adjustments" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "royalty_lines_statement_id_idx" ON "royalty_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "royalty_lines_source_invoice_id_idx" ON "royalty_lines" USING btree ("source_invoice_id");--> statement-breakpoint
CREATE INDEX "royalty_lines_source_payment_allocation_id_idx" ON "royalty_lines" USING btree ("source_payment_allocation_id");--> statement-breakpoint
CREATE INDEX "royalty_rules_franchise_id_idx" ON "royalty_rules" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "royalty_rules_territory_id_idx" ON "royalty_rules" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "royalty_rules_status_idx" ON "royalty_rules" USING btree ("status");--> statement-breakpoint
CREATE INDEX "royalty_rules_deleted_at_idx" ON "royalty_rules" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "royalty_statement_sequences_issuer_key_uidx" ON "royalty_statement_sequences" USING btree ("issuer_organisation_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "royalty_statements_issuer_number_uidx" ON "royalty_statements" USING btree ("issuer_organisation_id","statement_number");--> statement-breakpoint
CREATE UNIQUE INDEX "royalty_statements_franchise_period_uidx" ON "royalty_statements" USING btree ("franchise_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "royalty_statements_territory_id_idx" ON "royalty_statements" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "royalty_statements_status_idx" ON "royalty_statements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "royalty_statements_deleted_at_idx" ON "royalty_statements" USING btree ("deleted_at");