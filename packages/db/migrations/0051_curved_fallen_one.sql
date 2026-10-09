CREATE TABLE "ops_alert_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_status" text DEFAULT 'ok' NOT NULL,
	"last_alerted_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
