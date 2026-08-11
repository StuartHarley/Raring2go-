CREATE TABLE "oauth_connection_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"code_verifier_hash" text,
	"provider" text NOT NULL,
	"connection_type" text NOT NULL,
	"organisation_id" uuid,
	"territory_id" uuid,
	"requested_by_user_id" uuid NOT NULL,
	"return_to" text DEFAULT '/app/settings/connections' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"provider_safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connection_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_connection_id" uuid,
	"secret_ref" text NOT NULL,
	"backend" text DEFAULT 'postgres_aes_256_gcm' NOT NULL,
	"key_version" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"connection_type" text NOT NULL,
	"organisation_id" uuid,
	"territory_id" uuid,
	"external_account_id" text NOT NULL,
	"external_account_display_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"granted_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_expiry_at" timestamp with time zone,
	"last_health_check_at" timestamp with time zone,
	"last_health_status" text DEFAULT 'unknown' NOT NULL,
	"last_failure_code" text,
	"last_failure_summary" text,
	"connected_by_user_id" uuid,
	"connected_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"secret_ref" text,
	"provider_safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "provider_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_connection_transactions" ADD CONSTRAINT "oauth_connection_transactions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_connection_transactions" ADD CONSTRAINT "oauth_connection_transactions_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_connection_transactions" ADD CONSTRAINT "oauth_connection_transactions_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connection_secrets" ADD CONSTRAINT "provider_connection_secrets_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_connection_transactions_state_uidx" ON "oauth_connection_transactions" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "oauth_connection_transactions_user_idx" ON "oauth_connection_transactions" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "oauth_connection_transactions_expiry_idx" ON "oauth_connection_transactions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connection_secrets_ref_uidx" ON "provider_connection_secrets" USING btree ("secret_ref");--> statement-breakpoint
CREATE INDEX "provider_connection_secrets_connection_idx" ON "provider_connection_secrets" USING btree ("provider_connection_id");--> statement-breakpoint
CREATE INDEX "provider_connection_secrets_deleted_at_idx" ON "provider_connection_secrets" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_external_scope_uidx" ON "provider_connections" USING btree ("provider","connection_type","external_account_id","organisation_id","territory_id");--> statement-breakpoint
CREATE INDEX "provider_connections_provider_idx" ON "provider_connections" USING btree ("provider","connection_type");--> statement-breakpoint
CREATE INDEX "provider_connections_org_idx" ON "provider_connections" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "provider_connections_territory_idx" ON "provider_connections" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "provider_connections_status_idx" ON "provider_connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provider_connections_deleted_at_idx" ON "provider_connections" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_accounts_provider_connection_idx" ON "social_accounts" USING btree ("provider_connection_id");