CREATE TABLE "competition_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"outcome" text DEFAULT 'entered' NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"drawn_at" timestamp with time zone,
	"drawn_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_contact_id_audience_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."audience_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_entries" ADD CONSTRAINT "competition_entries_drawn_by_user_id_users_id_fk" FOREIGN KEY ("drawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competition_entries_competition_contact_uidx" ON "competition_entries" USING btree ("content_item_id","contact_id");--> statement-breakpoint
CREATE INDEX "competition_entries_contact_id_idx" ON "competition_entries" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "competition_entries_territory_id_idx" ON "competition_entries" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "competition_entries_outcome_idx" ON "competition_entries" USING btree ("outcome");