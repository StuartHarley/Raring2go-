CREATE TABLE "franchise_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"artifact_reference_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid,
	"uploaded_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchise_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"category" text NOT NULL,
	"document_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"current_version_id" uuid,
	"expiry_date" date,
	"uploaded_by_user_id" uuid,
	"archived_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "franchise_document_versions" ADD CONSTRAINT "franchise_document_versions_document_id_franchise_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."franchise_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_document_versions" ADD CONSTRAINT "franchise_document_versions_artifact_reference_id_franchise_artifact_references_id_fk" FOREIGN KEY ("artifact_reference_id") REFERENCES "public"."franchise_artifact_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_document_versions" ADD CONSTRAINT "franchise_document_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_documents" ADD CONSTRAINT "franchise_documents_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_documents" ADD CONSTRAINT "franchise_documents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_documents" ADD CONSTRAINT "franchise_documents_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_documents" ADD CONSTRAINT "franchise_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_document_versions_doc_number_uidx" ON "franchise_document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "franchise_document_versions_document_id_idx" ON "franchise_document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "franchise_document_versions_artifact_id_idx" ON "franchise_document_versions" USING btree ("artifact_reference_id");--> statement-breakpoint
CREATE INDEX "franchise_document_versions_deleted_at_idx" ON "franchise_document_versions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "franchise_documents_franchise_id_idx" ON "franchise_documents" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "franchise_documents_territory_id_idx" ON "franchise_documents" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "franchise_documents_category_idx" ON "franchise_documents" USING btree ("category");--> statement-breakpoint
CREATE INDEX "franchise_documents_status_idx" ON "franchise_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "franchise_documents_expiry_date_idx" ON "franchise_documents" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "franchise_documents_deleted_at_idx" ON "franchise_documents" USING btree ("deleted_at");