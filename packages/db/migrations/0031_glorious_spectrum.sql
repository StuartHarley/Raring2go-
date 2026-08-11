CREATE TABLE "public_analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"territory_id" uuid NOT NULL,
	"path" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"session_id" text,
	"parent_user_id" uuid,
	"attribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"privacy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_analytics_events" ADD CONSTRAINT "public_analytics_events_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_analytics_events" ADD CONSTRAINT "public_analytics_events_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_analytics_events_event_type_idx" ON "public_analytics_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "public_analytics_events_territory_id_idx" ON "public_analytics_events" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "public_analytics_events_entity_idx" ON "public_analytics_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "public_analytics_events_occurred_at_idx" ON "public_analytics_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "public_analytics_events_retain_until_idx" ON "public_analytics_events" USING btree ("retain_until");