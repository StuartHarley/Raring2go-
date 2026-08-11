CREATE TABLE "preflight_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"territory_edition_id" uuid,
	"status" text NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fixes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original_artifact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"derived_artifact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unfixable_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "preflight_results" ADD CONSTRAINT "preflight_results_territory_edition_id_territory_editions_id_fk" FOREIGN KEY ("territory_edition_id") REFERENCES "public"."territory_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preflight_results" ADD CONSTRAINT "preflight_results_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preflight_results_entity_idx" ON "preflight_results" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "preflight_results_territory_edition_id_idx" ON "preflight_results" USING btree ("territory_edition_id");--> statement-breakpoint
CREATE INDEX "preflight_results_status_idx" ON "preflight_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "preflight_results_deleted_at_idx" ON "preflight_results" USING btree ("deleted_at");