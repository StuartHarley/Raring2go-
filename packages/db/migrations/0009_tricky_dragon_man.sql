CREATE TABLE "master_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"page_count" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"readiness" text DEFAULT 'not_ready' NOT NULL,
	"publication_archive" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"season" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"accent" text DEFAULT 'spring' NOT NULL,
	"publication_date" date,
	"booking_deadline" date,
	"artwork_deadline" date,
	"editorial_deadline" date,
	"proof_deadline" date,
	"print_deadline" date,
	"distribution_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "seasons_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "territory_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_edition_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"franchise_organisation_id" uuid,
	"editor_user_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"publication_date" date,
	"booking_deadline" date,
	"artwork_deadline" date,
	"editorial_deadline" date,
	"proof_deadline" date,
	"print_deadline" date,
	"distribution_date" date,
	"page_count" integer NOT NULL,
	"print_status" text DEFAULT 'not_started' NOT NULL,
	"digital_status" text DEFAULT 'not_started' NOT NULL,
	"readiness" text DEFAULT 'not_ready' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"publication_archive" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_from_master_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "master_editions" ADD CONSTRAINT "master_editions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_editions" ADD CONSTRAINT "master_editions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_editions" ADD CONSTRAINT "master_editions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_editions" ADD CONSTRAINT "territory_editions_master_edition_id_master_editions_id_fk" FOREIGN KEY ("master_edition_id") REFERENCES "public"."master_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_editions" ADD CONSTRAINT "territory_editions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_editions" ADD CONSTRAINT "territory_editions_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_editions" ADD CONSTRAINT "territory_editions_franchise_organisation_id_organisations_id_fk" FOREIGN KEY ("franchise_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territory_editions" ADD CONSTRAINT "territory_editions_editor_user_id_users_id_fk" FOREIGN KEY ("editor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "master_editions_season_version_uidx" ON "master_editions" USING btree ("season_id","version");--> statement-breakpoint
CREATE INDEX "master_editions_season_id_idx" ON "master_editions" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "master_editions_status_idx" ON "master_editions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "master_editions_deleted_at_idx" ON "master_editions" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "seasons_key_idx" ON "seasons" USING btree ("key");--> statement-breakpoint
CREATE INDEX "seasons_year_idx" ON "seasons" USING btree ("year");--> statement-breakpoint
CREATE INDEX "seasons_status_idx" ON "seasons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "seasons_deleted_at_idx" ON "seasons" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "territory_editions_master_territory_uidx" ON "territory_editions" USING btree ("master_edition_id","territory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "territory_editions_season_territory_uidx" ON "territory_editions" USING btree ("season_id","territory_id");--> statement-breakpoint
CREATE INDEX "territory_editions_territory_id_idx" ON "territory_editions" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "territory_editions_status_idx" ON "territory_editions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "territory_editions_readiness_idx" ON "territory_editions" USING btree ("readiness");--> statement-breakpoint
CREATE INDEX "territory_editions_deleted_at_idx" ON "territory_editions" USING btree ("deleted_at");