CREATE TABLE "compliance_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"required_document_category" text,
	"required_document_type" text,
	"expiry_warning_days" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "compliance_requirements_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "franchise_compliance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"evidence_document_id" uuid,
	"status" text DEFAULT 'missing' NOT NULL,
	"expires_at" date,
	"verified_by_user_id" uuid,
	"verified_at" date,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchise_insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"policy_number" text NOT NULL,
	"cover_types" text[] DEFAULT '{}' NOT NULL,
	"cover_start_date" date NOT NULL,
	"cover_end_date" date NOT NULL,
	"evidence_document_id" uuid,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verified_by_user_id" uuid,
	"verified_at" date,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "franchise_compliance_records" ADD CONSTRAINT "franchise_compliance_records_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_compliance_records" ADD CONSTRAINT "franchise_compliance_records_requirement_id_compliance_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."compliance_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_compliance_records" ADD CONSTRAINT "franchise_compliance_records_evidence_document_id_franchise_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."franchise_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_compliance_records" ADD CONSTRAINT "franchise_compliance_records_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_insurance_policies" ADD CONSTRAINT "franchise_insurance_policies_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_insurance_policies" ADD CONSTRAINT "franchise_insurance_policies_evidence_document_id_franchise_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."franchise_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_insurance_policies" ADD CONSTRAINT "franchise_insurance_policies_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_requirements_key_idx" ON "compliance_requirements" USING btree ("key");--> statement-breakpoint
CREATE INDEX "compliance_requirements_active_idx" ON "compliance_requirements" USING btree ("active");--> statement-breakpoint
CREATE INDEX "compliance_requirements_deleted_at_idx" ON "compliance_requirements" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_compliance_records_franchise_requirement_uidx" ON "franchise_compliance_records" USING btree ("franchise_id","requirement_id");--> statement-breakpoint
CREATE INDEX "franchise_compliance_records_franchise_id_idx" ON "franchise_compliance_records" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "franchise_compliance_records_status_idx" ON "franchise_compliance_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "franchise_compliance_records_expires_at_idx" ON "franchise_compliance_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "franchise_compliance_records_deleted_at_idx" ON "franchise_compliance_records" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "franchise_insurance_policies_franchise_id_idx" ON "franchise_insurance_policies" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "franchise_insurance_policies_cover_end_date_idx" ON "franchise_insurance_policies" USING btree ("cover_end_date");--> statement-breakpoint
CREATE INDEX "franchise_insurance_policies_verification_status_idx" ON "franchise_insurance_policies" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "franchise_insurance_policies_deleted_at_idx" ON "franchise_insurance_policies" USING btree ("deleted_at");