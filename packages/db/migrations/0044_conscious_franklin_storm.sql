CREATE TABLE "franchise_health_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"config_id" uuid NOT NULL,
	"config_version" integer NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"band" text NOT NULL,
	"factors" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_score_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"factors" jsonb NOT NULL,
	"thresholds" jsonb NOT NULL,
	"change_note" text,
	"created_by_user_id" uuid,
	"activated_by_user_id" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_id" uuid,
	"snapshot_date" date NOT NULL,
	"definitions_version" text NOT NULL,
	"values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "franchise_health_snapshots" ADD CONSTRAINT "franchise_health_snapshots_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_health_snapshots" ADD CONSTRAINT "franchise_health_snapshots_config_id_health_score_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."health_score_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_score_configs" ADD CONSTRAINT "health_score_configs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_score_configs" ADD CONSTRAINT "health_score_configs_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_health_snapshots_territory_date_uidx" ON "franchise_health_snapshots" USING btree ("territory_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "franchise_health_snapshots_date_idx" ON "franchise_health_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "health_score_configs_version_uidx" ON "health_score_configs" USING btree ("version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "health_score_configs_one_active_uidx" ON "health_score_configs" USING btree ("status") WHERE "health_score_configs"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_scope_date_uidx" ON "metric_snapshots" USING btree ("territory_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_network_date_uidx" ON "metric_snapshots" USING btree ("snapshot_date") WHERE "metric_snapshots"."territory_id" is null;--> statement-breakpoint
CREATE INDEX "metric_snapshots_date_idx" ON "metric_snapshots" USING btree ("snapshot_date");