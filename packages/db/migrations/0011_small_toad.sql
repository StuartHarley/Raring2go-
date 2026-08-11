CREATE TABLE "edition_content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_level" text NOT NULL,
	"title" text NOT NULL,
	"content_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"inheritance_mode" text DEFAULT 'optional' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"localisable" boolean DEFAULT true NOT NULL,
	"advertiser_specific" boolean DEFAULT false NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"targeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"available_from" date,
	"expires_at" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "territory_edition_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_edition_id" uuid NOT NULL,
	"source_content_item_id" uuid NOT NULL,
	"source_version" integer DEFAULT 1 NOT NULL,
	"inheritance_state" text DEFAULT 'inherited' NOT NULL,
	"local_override" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"localised_by_user_id" uuid,
	"localised_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "edition_content_items" ADD CONSTRAINT "edition_content_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_edition_content" ADD CONSTRAINT "territory_edition_content_territory_edition_id_territory_editions_id_fk" FOREIGN KEY ("territory_edition_id") REFERENCES "public"."territory_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_edition_content" ADD CONSTRAINT "territory_edition_content_source_content_item_id_edition_content_items_id_fk" FOREIGN KEY ("source_content_item_id") REFERENCES "public"."edition_content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_edition_content" ADD CONSTRAINT "territory_edition_content_localised_by_user_id_users_id_fk" FOREIGN KEY ("localised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edition_content_items_source_level_idx" ON "edition_content_items" USING btree ("source_level");--> statement-breakpoint
CREATE INDEX "edition_content_items_status_idx" ON "edition_content_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "edition_content_items_inheritance_mode_idx" ON "edition_content_items" USING btree ("inheritance_mode");--> statement-breakpoint
CREATE INDEX "edition_content_items_deleted_at_idx" ON "edition_content_items" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "territory_edition_content_source_uidx" ON "territory_edition_content" USING btree ("territory_edition_id","source_content_item_id");--> statement-breakpoint
CREATE INDEX "territory_edition_content_edition_id_idx" ON "territory_edition_content" USING btree ("territory_edition_id");--> statement-breakpoint
CREATE INDEX "territory_edition_content_source_id_idx" ON "territory_edition_content" USING btree ("source_content_item_id");--> statement-breakpoint
CREATE INDEX "territory_edition_content_state_idx" ON "territory_edition_content" USING btree ("inheritance_state");--> statement-breakpoint
CREATE INDEX "territory_edition_content_deleted_at_idx" ON "territory_edition_content" USING btree ("deleted_at");