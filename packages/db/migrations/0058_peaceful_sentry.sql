CREATE TABLE "school_holiday_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_id" uuid,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "school_holiday_periods" ADD CONSTRAINT "school_holiday_periods_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_holiday_periods" ADD CONSTRAINT "school_holiday_periods_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "school_holiday_periods_scope_name_start_uidx" ON "school_holiday_periods" USING btree ("territory_id","name","starts_on");--> statement-breakpoint
CREATE INDEX "school_holiday_periods_starts_on_idx" ON "school_holiday_periods" USING btree ("starts_on");--> statement-breakpoint
CREATE INDEX "school_holiday_periods_deleted_at_idx" ON "school_holiday_periods" USING btree ("deleted_at");