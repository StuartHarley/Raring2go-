CREATE TABLE "edition_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_edition_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"spread_number" integer NOT NULL,
	"side" text NOT NULL,
	"status" text DEFAULT 'empty' NOT NULL,
	"template_version_id" uuid,
	"assigned_content_id" uuid,
	"advertiser_inventory_state" text DEFAULT 'unassigned' NOT NULL,
	"owner_type" text DEFAULT 'hq' NOT NULL,
	"deadline" date,
	"source_marker" text DEFAULT 'central' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"readiness" text DEFAULT 'not_ready' NOT NULL,
	"comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "edition_pages" ADD CONSTRAINT "edition_pages_territory_edition_id_territory_editions_id_fk" FOREIGN KEY ("territory_edition_id") REFERENCES "public"."territory_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_pages" ADD CONSTRAINT "edition_pages_template_version_id_magazine_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."magazine_template_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_pages" ADD CONSTRAINT "edition_pages_assigned_content_id_territory_edition_content_id_fk" FOREIGN KEY ("assigned_content_id") REFERENCES "public"."territory_edition_content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edition_pages_edition_page_uidx" ON "edition_pages" USING btree ("territory_edition_id","page_number");--> statement-breakpoint
CREATE INDEX "edition_pages_edition_id_idx" ON "edition_pages" USING btree ("territory_edition_id");--> statement-breakpoint
CREATE INDEX "edition_pages_status_idx" ON "edition_pages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "edition_pages_template_version_id_idx" ON "edition_pages" USING btree ("template_version_id");--> statement-breakpoint
CREATE INDEX "edition_pages_readiness_idx" ON "edition_pages" USING btree ("readiness");--> statement-breakpoint
CREATE INDEX "edition_pages_deleted_at_idx" ON "edition_pages" USING btree ("deleted_at");