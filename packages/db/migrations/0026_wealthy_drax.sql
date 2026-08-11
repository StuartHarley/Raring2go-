CREATE TABLE "network_newsletter_masters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"season_key" text,
	"locked_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"optional_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"local_editable_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "newsletter_factory_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_id" uuid NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"total_territories" integer DEFAULT 0 NOT NULL,
	"ready_count" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "territory_newsletter_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"email_campaign_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"inherited_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"local_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "network_newsletter_masters" ADD CONSTRAINT "network_newsletter_masters_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_newsletter_masters" ADD CONSTRAINT "network_newsletter_masters_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_newsletter_masters" ADD CONSTRAINT "network_newsletter_masters_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_factory_runs" ADD CONSTRAINT "newsletter_factory_runs_master_id_network_newsletter_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."network_newsletter_masters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_newsletter_editions" ADD CONSTRAINT "territory_newsletter_editions_master_id_network_newsletter_masters_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."network_newsletter_masters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_newsletter_editions" ADD CONSTRAINT "territory_newsletter_editions_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_newsletter_editions" ADD CONSTRAINT "territory_newsletter_editions_email_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("email_campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "network_newsletter_masters_template_id_idx" ON "network_newsletter_masters" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "network_newsletter_masters_status_idx" ON "network_newsletter_masters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "network_newsletter_masters_deleted_at_idx" ON "network_newsletter_masters" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_factory_runs_idempotency_uidx" ON "newsletter_factory_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "newsletter_factory_runs_master_id_idx" ON "newsletter_factory_runs" USING btree ("master_id");--> statement-breakpoint
CREATE UNIQUE INDEX "territory_newsletter_editions_master_territory_uidx" ON "territory_newsletter_editions" USING btree ("master_id","territory_id");--> statement-breakpoint
CREATE INDEX "territory_newsletter_editions_master_id_idx" ON "territory_newsletter_editions" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "territory_newsletter_editions_territory_id_idx" ON "territory_newsletter_editions" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "territory_newsletter_editions_status_idx" ON "territory_newsletter_editions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "territory_newsletter_editions_deleted_at_idx" ON "territory_newsletter_editions" USING btree ("deleted_at");