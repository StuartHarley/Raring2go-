CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"organisation_id" uuid,
	"territory_id" uuid,
	"external_account_reference" text NOT NULL,
	"display_name" text NOT NULL,
	"connection_status" text DEFAULT 'connected' NOT NULL,
	"connection_health" text DEFAULT 'healthy' NOT NULL,
	"capability_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid,
	"provider_key" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"variant_id" uuid,
	"variant_version_id" uuid,
	"territory_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"approval_state" text DEFAULT 'draft' NOT NULL,
	"publish_state" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"immutable_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"media_artifact_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta" text,
	"link_url" text,
	"advertiser_id" uuid,
	"commercial_booking_id" uuid,
	"published_external_reference" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"failure_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"scheduled_by_user_id" uuid,
	"published_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_publish_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_after" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"provider_key" text DEFAULT 'development' NOT NULL,
	"provider_request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_provider_events" ADD CONSTRAINT "social_provider_events_publication_id_social_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."social_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_variant_id_content_channel_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."content_channel_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_variant_version_id_content_channel_variant_versions_id_fk" FOREIGN KEY ("variant_version_id") REFERENCES "public"."content_channel_variant_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_scheduled_by_user_id_users_id_fk" FOREIGN KEY ("scheduled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_publish_jobs" ADD CONSTRAINT "social_publish_jobs_publication_id_social_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."social_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_external_reference_uidx" ON "social_accounts" USING btree ("channel","external_account_reference");--> statement-breakpoint
CREATE INDEX "social_accounts_channel_idx" ON "social_accounts" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "social_accounts_territory_id_idx" ON "social_accounts" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "social_accounts_connection_status_idx" ON "social_accounts" USING btree ("connection_status");--> statement-breakpoint
CREATE INDEX "social_accounts_deleted_at_idx" ON "social_accounts" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_provider_events_uidx" ON "social_provider_events" USING btree ("provider_key","provider_event_id");--> statement-breakpoint
CREATE INDEX "social_provider_events_publication_id_idx" ON "social_provider_events" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "social_provider_events_event_type_idx" ON "social_provider_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "social_publications_idempotency_uidx" ON "social_publications" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "social_publications_content_item_id_idx" ON "social_publications" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "social_publications_variant_id_idx" ON "social_publications" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "social_publications_territory_id_idx" ON "social_publications" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "social_publications_account_id_idx" ON "social_publications" USING btree ("social_account_id");--> statement-breakpoint
CREATE INDEX "social_publications_publish_state_idx" ON "social_publications" USING btree ("publish_state");--> statement-breakpoint
CREATE INDEX "social_publications_scheduled_at_idx" ON "social_publications" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "social_publications_deleted_at_idx" ON "social_publications" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_publish_jobs_idempotency_uidx" ON "social_publish_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "social_publish_jobs_publication_id_idx" ON "social_publish_jobs" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "social_publish_jobs_status_idx" ON "social_publish_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_publish_jobs_run_after_idx" ON "social_publish_jobs" USING btree ("run_after");