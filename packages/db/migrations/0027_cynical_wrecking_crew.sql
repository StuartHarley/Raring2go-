CREATE TABLE "content_ai_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" text NOT NULL,
	"content_item_id" uuid NOT NULL,
	"source_version_id" uuid,
	"target_channel" text,
	"status" text DEFAULT 'generated' NOT NULL,
	"provider_key" text,
	"model_reference" text,
	"prompt_template_version" text NOT NULL,
	"generated_output" jsonb NOT NULL,
	"generated_at" date NOT NULL,
	"human_decision" text,
	"decided_by_user_id" uuid,
	"decided_at" date,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_channel_variant_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'ai_draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"generated_by_task_id" uuid,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_channel_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'not_created' NOT NULL,
	"current_version_id" uuid,
	"territory_id" uuid,
	"scheduled_at" date,
	"published_at" date,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"content_item_id" uuid,
	"territory_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"processed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_summary" text,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"standfirst" text,
	"content_type" text NOT NULL,
	"owner_level" text DEFAULT 'network' NOT NULL,
	"organisation_id" uuid,
	"territory_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"author_user_id" uuid,
	"source_type" text DEFAULT 'human' NOT NULL,
	"source_reference" text,
	"hero_artifact_reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relevant_dates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"advertiser_id" uuid,
	"commercial_booking_id" uuid,
	"edition_content_item_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" date,
	"published_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_localisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_content_item_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"local_content_item_id" uuid,
	"state" text DEFAULT 'inherited' NOT NULL,
	"locked_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editable_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"local_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"master_version_number" integer DEFAULT 1 NOT NULL,
	"reviewed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_website_publishing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"variant_id" uuid,
	"provider_key" text DEFAULT 'development' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"prepared_snapshot" jsonb NOT NULL,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"prepared_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "content_ai_tasks" ADD CONSTRAINT "content_ai_tasks_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ai_tasks" ADD CONSTRAINT "content_ai_tasks_source_version_id_content_item_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."content_item_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ai_tasks" ADD CONSTRAINT "content_ai_tasks_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_channel_variant_versions" ADD CONSTRAINT "content_channel_variant_versions_variant_id_content_channel_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."content_channel_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_channel_variant_versions" ADD CONSTRAINT "content_channel_variant_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_channel_variant_versions" ADD CONSTRAINT "content_channel_variant_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_channel_variants" ADD CONSTRAINT "content_channel_variants_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_channel_variants" ADD CONSTRAINT "content_channel_variants_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_domain_events" ADD CONSTRAINT "content_domain_events_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_domain_events" ADD CONSTRAINT "content_domain_events_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_versions" ADD CONSTRAINT "content_item_versions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_versions" ADD CONSTRAINT "content_item_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_edition_content_item_id_edition_content_items_id_fk" FOREIGN KEY ("edition_content_item_id") REFERENCES "public"."edition_content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_localisations" ADD CONSTRAINT "content_localisations_master_content_item_id_content_items_id_fk" FOREIGN KEY ("master_content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_localisations" ADD CONSTRAINT "content_localisations_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_localisations" ADD CONSTRAINT "content_localisations_local_content_item_id_content_items_id_fk" FOREIGN KEY ("local_content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_website_publishing_jobs" ADD CONSTRAINT "content_website_publishing_jobs_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_website_publishing_jobs" ADD CONSTRAINT "content_website_publishing_jobs_variant_id_content_channel_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."content_channel_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_ai_tasks_task_idx" ON "content_ai_tasks" USING btree ("task");--> statement-breakpoint
CREATE INDEX "content_ai_tasks_content_item_id_idx" ON "content_ai_tasks" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "content_ai_tasks_target_channel_idx" ON "content_ai_tasks" USING btree ("target_channel");--> statement-breakpoint
CREATE INDEX "content_ai_tasks_deleted_at_idx" ON "content_ai_tasks" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_channel_variant_versions_variant_version_uidx" ON "content_channel_variant_versions" USING btree ("variant_id","version_number");--> statement-breakpoint
CREATE INDEX "content_channel_variant_versions_variant_id_idx" ON "content_channel_variant_versions" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "content_channel_variant_versions_status_idx" ON "content_channel_variant_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_channel_variant_versions_deleted_at_idx" ON "content_channel_variant_versions" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_channel_variants_item_channel_territory_uidx" ON "content_channel_variants" USING btree ("content_item_id","channel","territory_id");--> statement-breakpoint
CREATE INDEX "content_channel_variants_item_id_idx" ON "content_channel_variants" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "content_channel_variants_channel_idx" ON "content_channel_variants" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "content_channel_variants_status_idx" ON "content_channel_variants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_channel_variants_deleted_at_idx" ON "content_channel_variants" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_domain_events_idempotency_uidx" ON "content_domain_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "content_domain_events_type_idx" ON "content_domain_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "content_domain_events_content_item_id_idx" ON "content_domain_events" USING btree ("content_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_item_versions_item_version_uidx" ON "content_item_versions" USING btree ("content_item_id","version_number");--> statement-breakpoint
CREATE INDEX "content_item_versions_item_id_idx" ON "content_item_versions" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "content_item_versions_status_idx" ON "content_item_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_item_versions_deleted_at_idx" ON "content_item_versions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "content_items_type_idx" ON "content_items" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "content_items_owner_level_idx" ON "content_items" USING btree ("owner_level");--> statement-breakpoint
CREATE INDEX "content_items_territory_id_idx" ON "content_items" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "content_items_status_idx" ON "content_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_items_deleted_at_idx" ON "content_items" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_localisations_master_territory_uidx" ON "content_localisations" USING btree ("master_content_item_id","territory_id");--> statement-breakpoint
CREATE INDEX "content_localisations_master_id_idx" ON "content_localisations" USING btree ("master_content_item_id");--> statement-breakpoint
CREATE INDEX "content_localisations_territory_id_idx" ON "content_localisations" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "content_localisations_state_idx" ON "content_localisations" USING btree ("state");--> statement-breakpoint
CREATE INDEX "content_localisations_deleted_at_idx" ON "content_localisations" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_website_jobs_idempotency_uidx" ON "content_website_publishing_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "content_website_jobs_content_item_id_idx" ON "content_website_publishing_jobs" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "content_website_jobs_status_idx" ON "content_website_publishing_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_website_jobs_deleted_at_idx" ON "content_website_publishing_jobs" USING btree ("deleted_at");