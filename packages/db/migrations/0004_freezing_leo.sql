CREATE TABLE "agreement_signature_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_request_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreement_signature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_agreement_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"provider_key" text NOT NULL,
	"provider_request_id" text,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" date,
	"cancelled_at" date,
	"expired_at" date,
	"declined_at" date,
	"completed_at" date,
	"reissued_from_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agreement_signers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_request_id" uuid NOT NULL,
	"role" text NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"signing_order" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchise_artifact_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text,
	"checksum" text,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchise_domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"organisation_id" uuid,
	"territory_id" uuid,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD COLUMN "executed_at" date;--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD COLUMN "signed_agreement_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD COLUMN "completion_certificate_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "agreement_signature_events" ADD CONSTRAINT "agreement_signature_events_signature_request_id_agreement_signature_requests_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."agreement_signature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_signature_requests" ADD CONSTRAINT "agreement_signature_requests_franchise_agreement_id_franchise_agreements_id_fk" FOREIGN KEY ("franchise_agreement_id") REFERENCES "public"."franchise_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_signers" ADD CONSTRAINT "agreement_signers_signature_request_id_agreement_signature_requests_id_fk" FOREIGN KEY ("signature_request_id") REFERENCES "public"."agreement_signature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_signers" ADD CONSTRAINT "agreement_signers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_artifact_references" ADD CONSTRAINT "franchise_artifact_references_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_domain_events" ADD CONSTRAINT "franchise_domain_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_domain_events" ADD CONSTRAINT "franchise_domain_events_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_signature_events_provider_event_uidx" ON "agreement_signature_events" USING btree ("signature_request_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "agreement_signature_events_request_id_idx" ON "agreement_signature_events" USING btree ("signature_request_id");--> statement-breakpoint
CREATE INDEX "agreement_signature_events_type_idx" ON "agreement_signature_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "agreement_signature_requests_agreement_id_idx" ON "agreement_signature_requests" USING btree ("franchise_agreement_id");--> statement-breakpoint
CREATE INDEX "agreement_signature_requests_status_idx" ON "agreement_signature_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agreement_signature_requests_provider_request_id_idx" ON "agreement_signature_requests" USING btree ("provider_request_id");--> statement-breakpoint
CREATE INDEX "agreement_signature_requests_deleted_at_idx" ON "agreement_signature_requests" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "agreement_signers_request_id_idx" ON "agreement_signers" USING btree ("signature_request_id");--> statement-breakpoint
CREATE INDEX "agreement_signers_status_idx" ON "agreement_signers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agreement_signers_deleted_at_idx" ON "agreement_signers" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "franchise_artifacts_franchise_id_idx" ON "franchise_artifact_references" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "franchise_artifacts_entity_idx" ON "franchise_artifact_references" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "franchise_artifacts_category_idx" ON "franchise_artifact_references" USING btree ("category");--> statement-breakpoint
CREATE INDEX "franchise_artifacts_deleted_at_idx" ON "franchise_artifact_references" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_domain_events_idempotency_uidx" ON "franchise_domain_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "franchise_domain_events_type_idx" ON "franchise_domain_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "franchise_domain_events_entity_idx" ON "franchise_domain_events" USING btree ("entity_type","entity_id");