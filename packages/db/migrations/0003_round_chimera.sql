CREATE TABLE "agreement_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "agreement_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "agreement_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"controlled_merge_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchise_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"agreement_version_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"merge_variables" jsonb NOT NULL,
	"generated_content" jsonb NOT NULL,
	"submitted_at" date,
	"approved_by_user_id" uuid,
	"approved_at" date,
	"voided_at" date,
	"superseded_by_agreement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_template_id_agreement_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."agreement_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD CONSTRAINT "franchise_agreements_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD CONSTRAINT "franchise_agreements_agreement_version_id_agreement_versions_id_fk" FOREIGN KEY ("agreement_version_id") REFERENCES "public"."agreement_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD CONSTRAINT "franchise_agreements_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_templates_key_idx" ON "agreement_templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX "agreement_templates_status_idx" ON "agreement_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agreement_templates_deleted_at_idx" ON "agreement_templates" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "agreement_versions_template_id_idx" ON "agreement_versions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "agreement_versions_status_idx" ON "agreement_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agreement_versions_deleted_at_idx" ON "agreement_versions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "franchise_agreements_franchise_id_idx" ON "franchise_agreements" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "franchise_agreements_version_id_idx" ON "franchise_agreements" USING btree ("agreement_version_id");--> statement-breakpoint
CREATE INDEX "franchise_agreements_status_idx" ON "franchise_agreements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "franchise_agreements_deleted_at_idx" ON "franchise_agreements" USING btree ("deleted_at");