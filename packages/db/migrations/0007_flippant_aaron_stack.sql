CREATE TABLE "franchise_compliance_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"compliance_record_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"idempotency_key" text NOT NULL,
	"resolved_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchise_compliance_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"compliance_action_id" uuid NOT NULL,
	"reminder_type" text NOT NULL,
	"scheduled_for" date NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"idempotency_key" text NOT NULL,
	"sent_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "franchise_compliance_actions" ADD CONSTRAINT "franchise_compliance_actions_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_compliance_actions" ADD CONSTRAINT "franchise_compliance_actions_compliance_record_id_franchise_compliance_records_id_fk" FOREIGN KEY ("compliance_record_id") REFERENCES "public"."franchise_compliance_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_compliance_reminders" ADD CONSTRAINT "franchise_compliance_reminders_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_compliance_reminders" ADD CONSTRAINT "franchise_compliance_reminders_compliance_action_id_franchise_compliance_actions_id_fk" FOREIGN KEY ("compliance_action_id") REFERENCES "public"."franchise_compliance_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_compliance_actions_idempotency_uidx" ON "franchise_compliance_actions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "franchise_compliance_actions_franchise_id_idx" ON "franchise_compliance_actions" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "franchise_compliance_actions_status_idx" ON "franchise_compliance_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "franchise_compliance_actions_due_date_idx" ON "franchise_compliance_actions" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "franchise_compliance_actions_deleted_at_idx" ON "franchise_compliance_actions" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_compliance_reminders_idempotency_uidx" ON "franchise_compliance_reminders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "franchise_compliance_reminders_action_id_idx" ON "franchise_compliance_reminders" USING btree ("compliance_action_id");--> statement-breakpoint
CREATE INDEX "franchise_compliance_reminders_scheduled_for_idx" ON "franchise_compliance_reminders" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "franchise_compliance_reminders_status_idx" ON "franchise_compliance_reminders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "franchise_compliance_reminders_deleted_at_idx" ON "franchise_compliance_reminders" USING btree ("deleted_at");