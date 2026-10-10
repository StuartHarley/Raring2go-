CREATE TABLE "advertiser_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"territory_id" uuid NOT NULL,
	"assigned_to_user_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"due_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "advertiser_tasks" ADD CONSTRAINT "advertiser_tasks_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_tasks" ADD CONSTRAINT "advertiser_tasks_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_tasks" ADD CONSTRAINT "advertiser_tasks_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_tasks" ADD CONSTRAINT "advertiser_tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_tasks" ADD CONSTRAINT "advertiser_tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertiser_tasks" ADD CONSTRAINT "advertiser_tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertiser_tasks_advertiser_id_idx" ON "advertiser_tasks" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "advertiser_tasks_opportunity_id_idx" ON "advertiser_tasks" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "advertiser_tasks_territory_id_idx" ON "advertiser_tasks" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "advertiser_tasks_assignee_status_idx" ON "advertiser_tasks" USING btree ("assigned_to_user_id","status");--> statement-breakpoint
CREATE INDEX "advertiser_tasks_due_on_idx" ON "advertiser_tasks" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "advertiser_tasks_deleted_at_idx" ON "advertiser_tasks" USING btree ("deleted_at");