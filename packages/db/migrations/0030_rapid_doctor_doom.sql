CREATE TABLE "audience_preference_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"home_territory_id" uuid,
	"followed_territory_ids" uuid[] DEFAULT '{}' NOT NULL,
	"child_age_bands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"event_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offer_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"competition_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"newsletter_frequency" text DEFAULT 'weekly' NOT NULL,
	"communication_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"personalisation_enabled" boolean DEFAULT true NOT NULL,
	"privacy_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audience_saved_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"territory_id" uuid,
	"content_type" text NOT NULL,
	"content_reference_id" uuid,
	"title" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audience_preference_profiles" ADD CONSTRAINT "audience_preference_profiles_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_preference_profiles" ADD CONSTRAINT "audience_preference_profiles_home_territory_id_territories_id_fk" FOREIGN KEY ("home_territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_saved_content" ADD CONSTRAINT "audience_saved_content_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_saved_content" ADD CONSTRAINT "audience_saved_content_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audience_preference_profiles_contact_uidx" ON "audience_preference_profiles" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "audience_preference_profiles_home_territory_idx" ON "audience_preference_profiles" USING btree ("home_territory_id");--> statement-breakpoint
CREATE INDEX "audience_preference_profiles_deleted_at_idx" ON "audience_preference_profiles" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "audience_saved_content_contact_id_idx" ON "audience_saved_content" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "audience_saved_content_territory_id_idx" ON "audience_saved_content" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "audience_saved_content_deleted_at_idx" ON "audience_saved_content" USING btree ("deleted_at");