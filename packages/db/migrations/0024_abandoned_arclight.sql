CREATE TABLE "audience_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"territory_id" uuid,
	"activity_type" text NOT NULL,
	"title" text NOT NULL,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audience_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"territory_id" uuid,
	"consent_type" text NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_user_id" uuid,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalised" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"email_status" text DEFAULT 'subscribed' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audience_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_id" uuid,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_segment_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audience_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"segment_type" text DEFAULT 'dynamic' NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audience_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"email_normalised" text NOT NULL,
	"territory_id" uuid,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"suppressed_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_territory_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"status" text DEFAULT 'subscribed' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subscribed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audience_activity_events" ADD CONSTRAINT "audience_activity_events_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_activity_events" ADD CONSTRAINT "audience_activity_events_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_consent_events" ADD CONSTRAINT "audience_consent_events_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_consent_events" ADD CONSTRAINT "audience_consent_events_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_consent_events" ADD CONSTRAINT "audience_consent_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_imports" ADD CONSTRAINT "audience_imports_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_segment_members" ADD CONSTRAINT "audience_segment_members_segment_id_audience_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."audience_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_segment_members" ADD CONSTRAINT "audience_segment_members_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_segments" ADD CONSTRAINT "audience_segments_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_suppressions" ADD CONSTRAINT "audience_suppressions_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_suppressions" ADD CONSTRAINT "audience_suppressions_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_territory_subscriptions" ADD CONSTRAINT "audience_territory_subscriptions_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_territory_subscriptions" ADD CONSTRAINT "audience_territory_subscriptions_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audience_activity_contact_id_idx" ON "audience_activity_events" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "audience_activity_territory_id_idx" ON "audience_activity_events" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "audience_activity_type_idx" ON "audience_activity_events" USING btree ("activity_type");--> statement-breakpoint
CREATE INDEX "audience_activity_deleted_at_idx" ON "audience_activity_events" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "audience_consent_contact_id_idx" ON "audience_consent_events" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "audience_consent_territory_id_idx" ON "audience_consent_events" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "audience_consent_type_idx" ON "audience_consent_events" USING btree ("consent_type");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_contacts_email_uidx" ON "audience_contacts" USING btree ("email_normalised");--> statement-breakpoint
CREATE INDEX "audience_contacts_email_status_idx" ON "audience_contacts" USING btree ("email_status");--> statement-breakpoint
CREATE INDEX "audience_contacts_deleted_at_idx" ON "audience_contacts" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "audience_imports_territory_id_idx" ON "audience_imports" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "audience_imports_status_idx" ON "audience_imports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_segment_members_uidx" ON "audience_segment_members" USING btree ("segment_id","contact_id");--> statement-breakpoint
CREATE INDEX "audience_segment_members_contact_id_idx" ON "audience_segment_members" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "audience_segment_members_deleted_at_idx" ON "audience_segment_members" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_segments_key_uidx" ON "audience_segments" USING btree ("key");--> statement-breakpoint
CREATE INDEX "audience_segments_territory_id_idx" ON "audience_segments" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "audience_segments_deleted_at_idx" ON "audience_segments" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_suppressions_active_uidx" ON "audience_suppressions" USING btree ("email_normalised","territory_id","reason");--> statement-breakpoint
CREATE INDEX "audience_suppressions_contact_id_idx" ON "audience_suppressions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "audience_suppressions_active_idx" ON "audience_suppressions" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_subscriptions_contact_territory_uidx" ON "audience_territory_subscriptions" USING btree ("contact_id","territory_id");--> statement-breakpoint
CREATE INDEX "audience_subscriptions_territory_id_idx" ON "audience_territory_subscriptions" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "audience_subscriptions_status_idx" ON "audience_territory_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audience_subscriptions_deleted_at_idx" ON "audience_territory_subscriptions" USING btree ("deleted_at");