CREATE TABLE "franchise_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"user_id" uuid,
	"label" text NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_organisation_id" uuid NOT NULL,
	"primary_territory_id" uuid NOT NULL,
	"primary_owner_user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"lifecycle_stage" text DEFAULT 'trading' NOT NULL,
	"launch_date" date,
	"renewal_date" date,
	"end_date" date,
	"onboarding_status" text DEFAULT 'not_started' NOT NULL,
	"support_status" text DEFAULT 'standard' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "franchise_contacts" ADD CONSTRAINT "franchise_contacts_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_contacts" ADD CONSTRAINT "franchise_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchises" ADD CONSTRAINT "franchises_franchise_organisation_id_organisations_id_fk" FOREIGN KEY ("franchise_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchises" ADD CONSTRAINT "franchises_primary_territory_id_territories_id_fk" FOREIGN KEY ("primary_territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchises" ADD CONSTRAINT "franchises_primary_owner_user_id_users_id_fk" FOREIGN KEY ("primary_owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "franchise_contacts_franchise_id_idx" ON "franchise_contacts" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "franchise_contacts_user_id_idx" ON "franchise_contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "franchise_contacts_deleted_at_idx" ON "franchise_contacts" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "franchises_organisation_id_idx" ON "franchises" USING btree ("franchise_organisation_id");--> statement-breakpoint
CREATE INDEX "franchises_primary_territory_id_idx" ON "franchises" USING btree ("primary_territory_id");--> statement-breakpoint
CREATE INDEX "franchises_primary_owner_user_id_idx" ON "franchises" USING btree ("primary_owner_user_id");--> statement-breakpoint
CREATE INDEX "franchises_status_idx" ON "franchises" USING btree ("status");--> statement-breakpoint
CREATE INDEX "franchises_deleted_at_idx" ON "franchises" USING btree ("deleted_at");