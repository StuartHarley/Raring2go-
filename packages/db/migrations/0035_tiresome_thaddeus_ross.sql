ALTER TABLE "email_campaigns" ADD COLUMN "send_provider" text DEFAULT 'postmark' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "send_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "email_send_jobs" ADD COLUMN "send_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_send_connection_id_provider_connections_id_fk" FOREIGN KEY ("send_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_jobs" ADD CONSTRAINT "email_send_jobs_send_connection_id_provider_connections_id_fk" FOREIGN KEY ("send_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;