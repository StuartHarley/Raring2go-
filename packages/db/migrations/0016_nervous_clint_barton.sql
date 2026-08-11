CREATE TABLE "advertiser_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"activity_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertiser_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"user_id" uuid,
	"label" text NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"role" text DEFAULT 'contact' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertiser_metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"average_sale_value_minor" integer DEFAULT 0 NOT NULL,
	"annual_advertiser_value_minor" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"package_mix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"digital_mix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conversion_state" text DEFAULT 'unknown' NOT NULL,
	"churn_risk" text DEFAULT 'unknown' NOT NULL,
	"overdue_debt_minor" integer DEFAULT 0 NOT NULL,
	"benchmark_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "advertisers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_organisation_id" uuid NOT NULL,
	"owning_territory_id" uuid NOT NULL,
	"account_owner_user_id" uuid,
	"status" text DEFAULT 'prospect' NOT NULL,
	"relationship_state" text DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"first_booked_on" date,
	"last_booked_on" date,
	"lapsed_on" date,
	"average_sale_value_minor" integer DEFAULT 0 NOT NULL,
	"annual_advertiser_value_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"commercial_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "advertiser_activity_events" ADD CONSTRAINT "advertiser_activity_events_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_activity_events" ADD CONSTRAINT "advertiser_activity_events_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_activity_events" ADD CONSTRAINT "advertiser_activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_contacts" ADD CONSTRAINT "advertiser_contacts_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_contacts" ADD CONSTRAINT "advertiser_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_metric_snapshots" ADD CONSTRAINT "advertiser_metric_snapshots_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_metric_snapshots" ADD CONSTRAINT "advertiser_metric_snapshots_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_advertiser_organisation_id_organisations_id_fk" FOREIGN KEY ("advertiser_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_owning_territory_id_territories_id_fk" FOREIGN KEY ("owning_territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_account_owner_user_id_users_id_fk" FOREIGN KEY ("account_owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertiser_activity_events_advertiser_id_idx" ON "advertiser_activity_events" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "advertiser_activity_events_territory_id_idx" ON "advertiser_activity_events" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "advertiser_activity_events_type_idx" ON "advertiser_activity_events" USING btree ("activity_type");--> statement-breakpoint
CREATE INDEX "advertiser_activity_events_deleted_at_idx" ON "advertiser_activity_events" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "advertiser_contacts_advertiser_id_idx" ON "advertiser_contacts" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "advertiser_contacts_user_id_idx" ON "advertiser_contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "advertiser_contacts_deleted_at_idx" ON "advertiser_contacts" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_metric_snapshots_period_uidx" ON "advertiser_metric_snapshots" USING btree ("advertiser_id","period_key");--> statement-breakpoint
CREATE INDEX "advertiser_metric_snapshots_territory_id_idx" ON "advertiser_metric_snapshots" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "advertiser_metric_snapshots_deleted_at_idx" ON "advertiser_metric_snapshots" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisers_organisation_uidx" ON "advertisers" USING btree ("advertiser_organisation_id");--> statement-breakpoint
CREATE INDEX "advertisers_owning_territory_id_idx" ON "advertisers" USING btree ("owning_territory_id");--> statement-breakpoint
CREATE INDEX "advertisers_status_idx" ON "advertisers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "advertisers_relationship_state_idx" ON "advertisers" USING btree ("relationship_state");--> statement-breakpoint
CREATE INDEX "advertisers_deleted_at_idx" ON "advertisers" USING btree ("deleted_at");