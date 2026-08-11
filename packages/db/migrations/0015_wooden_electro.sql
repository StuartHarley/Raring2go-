CREATE TABLE "publication_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_edition_id" uuid NOT NULL,
	"output_type" text NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"source_page_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preflight_result_id" uuid,
	"idempotency_key" text NOT NULL,
	"corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_by_user_id" uuid,
	"generated_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "publication_outputs" ADD CONSTRAINT "publication_outputs_territory_edition_id_territory_editions_id_fk" FOREIGN KEY ("territory_edition_id") REFERENCES "public"."territory_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_outputs" ADD CONSTRAINT "publication_outputs_preflight_result_id_preflight_results_id_fk" FOREIGN KEY ("preflight_result_id") REFERENCES "public"."preflight_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_outputs" ADD CONSTRAINT "publication_outputs_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publication_outputs_idempotency_uidx" ON "publication_outputs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "publication_outputs_territory_edition_id_idx" ON "publication_outputs" USING btree ("territory_edition_id");--> statement-breakpoint
CREATE INDEX "publication_outputs_type_status_idx" ON "publication_outputs" USING btree ("output_type","status");--> statement-breakpoint
CREATE INDEX "publication_outputs_deleted_at_idx" ON "publication_outputs" USING btree ("deleted_at");