CREATE TABLE "webhook_event_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_claims_provider_event_uidx" ON "webhook_event_claims" USING btree ("provider_key","event_id");--> statement-breakpoint
CREATE INDEX "webhook_event_claims_claimed_at_idx" ON "webhook_event_claims" USING btree ("claimed_at");