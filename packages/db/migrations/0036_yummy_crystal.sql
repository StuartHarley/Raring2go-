CREATE TABLE "file_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer,
	"checksum" text,
	"access_scope" text NOT NULL,
	"organisation_id" uuid,
	"territory_id" uuid,
	"owner_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"virus_scan_status" text DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "file_references" ADD CONSTRAINT "file_references_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_references" ADD CONSTRAINT "file_references_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_references" ADD CONSTRAINT "file_references_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_references_organisation_idx" ON "file_references" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "file_references_territory_idx" ON "file_references" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "file_references_owner_idx" ON "file_references" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "file_references_scan_status_idx" ON "file_references" USING btree ("virus_scan_status");--> statement-breakpoint
CREATE INDEX "file_references_deleted_at_idx" ON "file_references" USING btree ("deleted_at");