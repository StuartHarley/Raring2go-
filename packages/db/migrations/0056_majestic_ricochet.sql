CREATE TABLE "public_homepage_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text DEFAULT 'r2go-territory-homepage' NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_homepage_templates" ADD CONSTRAINT "public_homepage_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_homepage_templates" ADD CONSTRAINT "public_homepage_templates_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_homepage_templates_key_version_uidx" ON "public_homepage_templates" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "public_homepage_templates_status_idx" ON "public_homepage_templates" USING btree ("status");