CREATE TABLE "campaign_fulfilments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"booking_item_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"artwork_requirement_id" uuid,
	"territory_edition_id" uuid,
	"edition_page_id" uuid,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"channel" text DEFAULT 'print' NOT NULL,
	"scheduled_on" date,
	"fulfilled_on" date,
	"placement_reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"performance_reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "proof_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfilment_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_at" date,
	"delivered_at" date,
	"proof_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"artefact_reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"renewal_prompt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "renewal_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"source_booking_id" uuid,
	"source_proof_pack_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"due_on" date,
	"assigned_to_user_id" uuid,
	"opportunity_id" uuid,
	"renewal_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "campaign_fulfilments" ADD CONSTRAINT "campaign_fulfilments_booking_id_commercial_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."commercial_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_fulfilments" ADD CONSTRAINT "campaign_fulfilments_booking_item_id_commercial_booking_items_id_fk" FOREIGN KEY ("booking_item_id") REFERENCES "public"."commercial_booking_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_fulfilments" ADD CONSTRAINT "campaign_fulfilments_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_fulfilments" ADD CONSTRAINT "campaign_fulfilments_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_fulfilments" ADD CONSTRAINT "campaign_fulfilments_artwork_requirement_id_artwork_requirements_id_fk" FOREIGN KEY ("artwork_requirement_id") REFERENCES "public"."artwork_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_fulfilments" ADD CONSTRAINT "campaign_fulfilments_territory_edition_id_territory_editions_id_fk" FOREIGN KEY ("territory_edition_id") REFERENCES "public"."territory_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_fulfilments" ADD CONSTRAINT "campaign_fulfilments_edition_page_id_edition_pages_id_fk" FOREIGN KEY ("edition_page_id") REFERENCES "public"."edition_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_packs" ADD CONSTRAINT "proof_packs_fulfilment_id_campaign_fulfilments_id_fk" FOREIGN KEY ("fulfilment_id") REFERENCES "public"."campaign_fulfilments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_packs" ADD CONSTRAINT "proof_packs_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_packs" ADD CONSTRAINT "proof_packs_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_prompts" ADD CONSTRAINT "renewal_prompts_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_prompts" ADD CONSTRAINT "renewal_prompts_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_prompts" ADD CONSTRAINT "renewal_prompts_source_booking_id_commercial_bookings_id_fk" FOREIGN KEY ("source_booking_id") REFERENCES "public"."commercial_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_prompts" ADD CONSTRAINT "renewal_prompts_source_proof_pack_id_proof_packs_id_fk" FOREIGN KEY ("source_proof_pack_id") REFERENCES "public"."proof_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_prompts" ADD CONSTRAINT "renewal_prompts_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_prompts" ADD CONSTRAINT "renewal_prompts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_fulfilments_booking_item_uidx" ON "campaign_fulfilments" USING btree ("booking_item_id");--> statement-breakpoint
CREATE INDEX "campaign_fulfilments_advertiser_id_idx" ON "campaign_fulfilments" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "campaign_fulfilments_territory_id_idx" ON "campaign_fulfilments" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "campaign_fulfilments_status_idx" ON "campaign_fulfilments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaign_fulfilments_deleted_at_idx" ON "campaign_fulfilments" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proof_packs_fulfilment_uidx" ON "proof_packs" USING btree ("fulfilment_id");--> statement-breakpoint
CREATE INDEX "proof_packs_advertiser_id_idx" ON "proof_packs" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "proof_packs_territory_id_idx" ON "proof_packs" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "proof_packs_status_idx" ON "proof_packs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "proof_packs_deleted_at_idx" ON "proof_packs" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "renewal_prompts_advertiser_id_idx" ON "renewal_prompts" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "renewal_prompts_territory_id_idx" ON "renewal_prompts" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "renewal_prompts_status_idx" ON "renewal_prompts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "renewal_prompts_due_on_idx" ON "renewal_prompts" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "renewal_prompts_deleted_at_idx" ON "renewal_prompts" USING btree ("deleted_at");