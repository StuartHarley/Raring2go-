CREATE TABLE "email_send_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"campaign_version_id" uuid NOT NULL,
	"recipient_snapshot_id" uuid NOT NULL,
	"send_provider" text DEFAULT 'postmark' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"batch_size" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_send_jobs" ADD CONSTRAINT "email_send_jobs_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_jobs" ADD CONSTRAINT "email_send_jobs_campaign_version_id_email_campaign_versions_id_fk" FOREIGN KEY ("campaign_version_id") REFERENCES "public"."email_campaign_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_jobs" ADD CONSTRAINT "email_send_jobs_recipient_snapshot_id_email_recipient_snapshots_id_fk" FOREIGN KEY ("recipient_snapshot_id") REFERENCES "public"."email_recipient_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_send_jobs_campaign_id_idx" ON "email_send_jobs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "email_send_jobs_claim_idx" ON "email_send_jobs" USING btree ("status","next_attempt_at");