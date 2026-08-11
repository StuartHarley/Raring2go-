CREATE TABLE "marketing_journey_audience_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"journey_version_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"territory_id" uuid,
	"source_event_type" text NOT NULL,
	"source_event_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"exited_at" timestamp with time zone,
	"exit_reason" text,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_journey_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"current_step_key" text,
	"run_after" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"failure_reason" text,
	"completed_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_journey_step_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"action_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_journey_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journey_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_suggestions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "marketing_journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"territory_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"purpose" text DEFAULT 'marketing' NOT NULL,
	"description" text,
	"frequency_cap" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "marketing_journey_audience_entries" ADD CONSTRAINT "marketing_journey_audience_entries_journey_id_marketing_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."marketing_journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journey_audience_entries" ADD CONSTRAINT "marketing_journey_audience_entries_journey_version_id_marketing_journey_versions_id_fk" FOREIGN KEY ("journey_version_id") REFERENCES "public"."marketing_journey_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journey_audience_entries" ADD CONSTRAINT "marketing_journey_audience_entries_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journey_audience_entries" ADD CONSTRAINT "marketing_journey_audience_entries_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journey_executions" ADD CONSTRAINT "marketing_journey_executions_entry_id_marketing_journey_audience_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."marketing_journey_audience_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journey_executions" ADD CONSTRAINT "marketing_journey_executions_journey_id_marketing_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."marketing_journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journey_step_executions" ADD CONSTRAINT "marketing_journey_step_executions_execution_id_marketing_journey_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."marketing_journey_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journey_versions" ADD CONSTRAINT "marketing_journey_versions_journey_id_marketing_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."marketing_journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journey_versions" ADD CONSTRAINT "marketing_journey_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journeys" ADD CONSTRAINT "marketing_journeys_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journeys" ADD CONSTRAINT "marketing_journeys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_journeys" ADD CONSTRAINT "marketing_journeys_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_journey_entries_idempotency_uidx" ON "marketing_journey_audience_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "marketing_journey_entries_contact_id_idx" ON "marketing_journey_audience_entries" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "marketing_journey_entries_journey_id_idx" ON "marketing_journey_audience_entries" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "marketing_journey_entries_status_idx" ON "marketing_journey_audience_entries" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_journey_executions_idempotency_uidx" ON "marketing_journey_executions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "marketing_journey_executions_entry_id_idx" ON "marketing_journey_executions" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "marketing_journey_executions_status_idx" ON "marketing_journey_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "marketing_journey_executions_run_after_idx" ON "marketing_journey_executions" USING btree ("run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_journey_step_exec_idempotency_uidx" ON "marketing_journey_step_executions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "marketing_journey_step_exec_execution_id_idx" ON "marketing_journey_step_executions" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "marketing_journey_step_exec_status_idx" ON "marketing_journey_step_executions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_journey_versions_journey_version_uidx" ON "marketing_journey_versions" USING btree ("journey_id","version_number");--> statement-breakpoint
CREATE INDEX "marketing_journey_versions_journey_id_idx" ON "marketing_journey_versions" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "marketing_journey_versions_status_idx" ON "marketing_journey_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "marketing_journey_versions_deleted_at_idx" ON "marketing_journey_versions" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_journeys_key_uidx" ON "marketing_journeys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "marketing_journeys_territory_id_idx" ON "marketing_journeys" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "marketing_journeys_status_idx" ON "marketing_journeys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "marketing_journeys_deleted_at_idx" ON "marketing_journeys" USING btree ("deleted_at");