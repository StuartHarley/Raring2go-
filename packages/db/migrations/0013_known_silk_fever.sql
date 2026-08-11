CREATE TABLE "edition_page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"actor_user_id" uuid,
	"change_type" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "edition_page_revisions" ADD CONSTRAINT "edition_page_revisions_page_id_edition_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."edition_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_page_revisions" ADD CONSTRAINT "edition_page_revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edition_page_revisions_page_revision_uidx" ON "edition_page_revisions" USING btree ("page_id","revision_number");--> statement-breakpoint
CREATE INDEX "edition_page_revisions_page_id_idx" ON "edition_page_revisions" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "edition_page_revisions_change_type_idx" ON "edition_page_revisions" USING btree ("change_type");--> statement-breakpoint
CREATE INDEX "edition_page_revisions_deleted_at_idx" ON "edition_page_revisions" USING btree ("deleted_at");