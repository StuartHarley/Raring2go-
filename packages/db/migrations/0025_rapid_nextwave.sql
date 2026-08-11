CREATE TABLE "email_campaign_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subject" text NOT NULL,
	"preheader" text,
	"content_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_id" uuid,
	"template_id" uuid,
	"segment_id" uuid,
	"campaign_type" text DEFAULT 'newsletter' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"subject" text NOT NULL,
	"preheader" text,
	"scheduled_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_delivery_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"campaign_version_id" uuid NOT NULL,
	"recipient_snapshot_id" uuid,
	"contact_id" uuid,
	"email_normalised" text NOT NULL,
	"provider_key" text,
	"provider_message_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"event_type" text,
	"event_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_recipient_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"campaign_version_id" uuid NOT NULL,
	"segment_id" uuid,
	"status" text DEFAULT 'created' NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"template_type" text DEFAULT 'newsletter' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "email_campaign_versions" ADD CONSTRAINT "email_campaign_versions_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_versions" ADD CONSTRAINT "email_campaign_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_versions" ADD CONSTRAINT "email_campaign_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_segment_id_audience_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."audience_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_records" ADD CONSTRAINT "email_delivery_records_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_records" ADD CONSTRAINT "email_delivery_records_campaign_version_id_email_campaign_versions_id_fk" FOREIGN KEY ("campaign_version_id") REFERENCES "public"."email_campaign_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_records" ADD CONSTRAINT "email_delivery_records_recipient_snapshot_id_email_recipient_snapshots_id_fk" FOREIGN KEY ("recipient_snapshot_id") REFERENCES "public"."email_recipient_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_delivery_records" ADD CONSTRAINT "email_delivery_records_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_snapshots" ADD CONSTRAINT "email_recipient_snapshots_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_snapshots" ADD CONSTRAINT "email_recipient_snapshots_campaign_version_id_email_campaign_versions_id_fk" FOREIGN KEY ("campaign_version_id") REFERENCES "public"."email_campaign_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_snapshots" ADD CONSTRAINT "email_recipient_snapshots_segment_id_audience_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."audience_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_versions_campaign_version_uidx" ON "email_campaign_versions" USING btree ("campaign_id","version_number");--> statement-breakpoint
CREATE INDEX "email_campaign_versions_campaign_id_idx" ON "email_campaign_versions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "email_campaign_versions_status_idx" ON "email_campaign_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_campaign_versions_deleted_at_idx" ON "email_campaign_versions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "email_campaigns_territory_id_idx" ON "email_campaigns" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "email_campaigns_segment_id_idx" ON "email_campaigns" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "email_campaigns_status_idx" ON "email_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_campaigns_deleted_at_idx" ON "email_campaigns" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_provider_message_uidx" ON "email_delivery_records" USING btree ("provider_key","provider_message_id","event_type");--> statement-breakpoint
CREATE INDEX "email_delivery_campaign_id_idx" ON "email_delivery_records" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "email_delivery_contact_id_idx" ON "email_delivery_records" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "email_delivery_status_idx" ON "email_delivery_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_delivery_deleted_at_idx" ON "email_delivery_records" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_recipient_snapshots_idempotency_uidx" ON "email_recipient_snapshots" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_recipient_snapshots_campaign_id_idx" ON "email_recipient_snapshots" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_key_uidx" ON "email_templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX "email_templates_status_idx" ON "email_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_templates_deleted_at_idx" ON "email_templates" USING btree ("deleted_at");