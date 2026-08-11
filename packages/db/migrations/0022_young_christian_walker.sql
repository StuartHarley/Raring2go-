CREATE TABLE "artwork_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_request_id" uuid NOT NULL,
	"booking_item_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"territory_edition_id" uuid,
	"edition_page_id" uuid,
	"inventory_slot_id" uuid,
	"source_type" text DEFAULT 'advertiser_supplied' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"specification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deadline" date,
	"approved_version_id" uuid,
	"proof_reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"advertiser_approved_at" date,
	"production_approved_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artwork_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_requirement_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"submitted_by_user_id" uuid,
	"asset_reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"preflight_result_id" uuid,
	"notes" text,
	"submitted_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "artwork_requirements" ADD CONSTRAINT "artwork_requirements_production_request_id_commercial_production_requests_id_fk" FOREIGN KEY ("production_request_id") REFERENCES "public"."commercial_production_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_requirements" ADD CONSTRAINT "artwork_requirements_booking_item_id_commercial_booking_items_id_fk" FOREIGN KEY ("booking_item_id") REFERENCES "public"."commercial_booking_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_requirements" ADD CONSTRAINT "artwork_requirements_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_requirements" ADD CONSTRAINT "artwork_requirements_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_requirements" ADD CONSTRAINT "artwork_requirements_territory_edition_id_territory_editions_id_fk" FOREIGN KEY ("territory_edition_id") REFERENCES "public"."territory_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_requirements" ADD CONSTRAINT "artwork_requirements_edition_page_id_edition_pages_id_fk" FOREIGN KEY ("edition_page_id") REFERENCES "public"."edition_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_requirements" ADD CONSTRAINT "artwork_requirements_inventory_slot_id_inventory_slots_id_fk" FOREIGN KEY ("inventory_slot_id") REFERENCES "public"."inventory_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_artwork_requirement_id_artwork_requirements_id_fk" FOREIGN KEY ("artwork_requirement_id") REFERENCES "public"."artwork_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_versions" ADD CONSTRAINT "artwork_versions_preflight_result_id_preflight_results_id_fk" FOREIGN KEY ("preflight_result_id") REFERENCES "public"."preflight_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_requirements_production_request_uidx" ON "artwork_requirements" USING btree ("production_request_id");--> statement-breakpoint
CREATE INDEX "artwork_requirements_advertiser_id_idx" ON "artwork_requirements" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "artwork_requirements_territory_id_idx" ON "artwork_requirements" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "artwork_requirements_status_idx" ON "artwork_requirements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "artwork_requirements_deleted_at_idx" ON "artwork_requirements" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_versions_requirement_version_uidx" ON "artwork_versions" USING btree ("artwork_requirement_id","version_number");--> statement-breakpoint
CREATE INDEX "artwork_versions_requirement_id_idx" ON "artwork_versions" USING btree ("artwork_requirement_id");--> statement-breakpoint
CREATE INDEX "artwork_versions_preflight_result_id_idx" ON "artwork_versions" USING btree ("preflight_result_id");--> statement-breakpoint
CREATE INDEX "artwork_versions_status_idx" ON "artwork_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "artwork_versions_deleted_at_idx" ON "artwork_versions" USING btree ("deleted_at");