CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"stage_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"estimated_value_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"expected_close_date" date,
	"next_action" text,
	"next_action_date" date,
	"notes" text,
	"lost_reason" text,
	"competitor" text,
	"closed_at" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"probability_default" integer DEFAULT 0 NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_advertiser_id_idx" ON "opportunities" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "opportunities_territory_id_idx" ON "opportunities" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "opportunities_owner_user_id_idx" ON "opportunities" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "opportunities_stage_id_idx" ON "opportunities" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "opportunities_next_action_date_idx" ON "opportunities" USING btree ("next_action_date");--> statement-breakpoint
CREATE INDEX "opportunities_expected_close_date_idx" ON "opportunities" USING btree ("expected_close_date");--> statement-breakpoint
CREATE INDEX "opportunities_deleted_at_idx" ON "opportunities" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_key_uidx" ON "pipeline_stages" USING btree ("key");--> statement-breakpoint
CREATE INDEX "pipeline_stages_sort_order_idx" ON "pipeline_stages" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "pipeline_stages_deleted_at_idx" ON "pipeline_stages" USING btree ("deleted_at");