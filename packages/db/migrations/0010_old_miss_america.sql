CREATE TABLE "magazine_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"page_dimensions" jsonb NOT NULL,
	"bleed" jsonb NOT NULL,
	"trim" jsonb NOT NULL,
	"margins" jsonb NOT NULL,
	"grid" jsonb NOT NULL,
	"locked_elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editable_zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"copy_zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headline_zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"advertiser_zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"footer_furniture" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"print_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"digital_enhancements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" date,
	"published_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "magazine_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "magazine_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "magazine_template_versions" ADD CONSTRAINT "magazine_template_versions_template_id_magazine_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."magazine_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magazine_template_versions" ADD CONSTRAINT "magazine_template_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magazine_templates" ADD CONSTRAINT "magazine_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "magazine_template_versions_template_version_uidx" ON "magazine_template_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE INDEX "magazine_template_versions_template_id_idx" ON "magazine_template_versions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "magazine_template_versions_status_idx" ON "magazine_template_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "magazine_template_versions_deleted_at_idx" ON "magazine_template_versions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "magazine_templates_key_idx" ON "magazine_templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX "magazine_templates_category_idx" ON "magazine_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX "magazine_templates_status_idx" ON "magazine_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "magazine_templates_deleted_at_idx" ON "magazine_templates" USING btree ("deleted_at");