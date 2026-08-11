CREATE TABLE "advertiser_domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"advertiser_id" uuid,
	"territory_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"processed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advertiser_proposal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"terms_id" uuid NOT NULL,
	"booking_id" uuid,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"accepted_by_contact_id" uuid,
	"accepted_at" date,
	"rejected_at" date,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"commercial_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertiser_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "advertiser_domain_events" ADD CONSTRAINT "advertiser_domain_events_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_domain_events" ADD CONSTRAINT "advertiser_domain_events_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_proposal_acceptances" ADD CONSTRAINT "advertiser_proposal_acceptances_proposal_id_commercial_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."commercial_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_proposal_acceptances" ADD CONSTRAINT "advertiser_proposal_acceptances_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_proposal_acceptances" ADD CONSTRAINT "advertiser_proposal_acceptances_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_proposal_acceptances" ADD CONSTRAINT "advertiser_proposal_acceptances_terms_id_advertiser_terms_id_fk" FOREIGN KEY ("terms_id") REFERENCES "public"."advertiser_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_proposal_acceptances" ADD CONSTRAINT "advertiser_proposal_acceptances_booking_id_commercial_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."commercial_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_proposal_acceptances" ADD CONSTRAINT "advertiser_proposal_acceptances_accepted_by_contact_id_advertiser_contacts_id_fk" FOREIGN KEY ("accepted_by_contact_id") REFERENCES "public"."advertiser_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_domain_events_idempotency_uidx" ON "advertiser_domain_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "advertiser_domain_events_type_idx" ON "advertiser_domain_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "advertiser_domain_events_entity_idx" ON "advertiser_domain_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_proposal_acceptances_idempotency_uidx" ON "advertiser_proposal_acceptances" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "advertiser_proposal_acceptances_proposal_id_idx" ON "advertiser_proposal_acceptances" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "advertiser_proposal_acceptances_advertiser_id_idx" ON "advertiser_proposal_acceptances" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "advertiser_proposal_acceptances_status_idx" ON "advertiser_proposal_acceptances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "advertiser_proposal_acceptances_deleted_at_idx" ON "advertiser_proposal_acceptances" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_terms_key_version_uidx" ON "advertiser_terms" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "advertiser_terms_status_idx" ON "advertiser_terms" USING btree ("status");--> statement-breakpoint
CREATE INDEX "advertiser_terms_deleted_at_idx" ON "advertiser_terms" USING btree ("deleted_at");