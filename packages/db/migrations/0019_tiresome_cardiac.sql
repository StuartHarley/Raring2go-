CREATE TABLE "commercial_booking_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"proposal_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"inventory_reservation_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"total_price_minor" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commercial_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"territory_id" uuid NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"booked_on" date NOT NULL,
	"total_value_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commercial_production_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"booking_item_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"territory_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"due_on" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commercial_proposal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"package_id" uuid,
	"inventory_slot_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"total_price_minor" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commercial_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"territory_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"total_value_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"valid_until" date,
	"sent_on" date,
	"accepted_on" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "commercial_booking_items" ADD CONSTRAINT "commercial_booking_items_booking_id_commercial_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."commercial_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_booking_items" ADD CONSTRAINT "commercial_booking_items_proposal_item_id_commercial_proposal_items_id_fk" FOREIGN KEY ("proposal_item_id") REFERENCES "public"."commercial_proposal_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_booking_items" ADD CONSTRAINT "commercial_booking_items_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_booking_items" ADD CONSTRAINT "commercial_booking_items_inventory_reservation_id_inventory_reservations_id_fk" FOREIGN KEY ("inventory_reservation_id") REFERENCES "public"."inventory_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_bookings" ADD CONSTRAINT "commercial_bookings_proposal_id_commercial_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."commercial_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_bookings" ADD CONSTRAINT "commercial_bookings_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_bookings" ADD CONSTRAINT "commercial_bookings_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_bookings" ADD CONSTRAINT "commercial_bookings_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_production_requests" ADD CONSTRAINT "commercial_production_requests_booking_id_commercial_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."commercial_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_production_requests" ADD CONSTRAINT "commercial_production_requests_booking_item_id_commercial_booking_items_id_fk" FOREIGN KEY ("booking_item_id") REFERENCES "public"."commercial_booking_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_production_requests" ADD CONSTRAINT "commercial_production_requests_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_production_requests" ADD CONSTRAINT "commercial_production_requests_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_proposal_items" ADD CONSTRAINT "commercial_proposal_items_proposal_id_commercial_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."commercial_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_proposal_items" ADD CONSTRAINT "commercial_proposal_items_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_proposal_items" ADD CONSTRAINT "commercial_proposal_items_package_id_commercial_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."commercial_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_proposal_items" ADD CONSTRAINT "commercial_proposal_items_inventory_slot_id_inventory_slots_id_fk" FOREIGN KEY ("inventory_slot_id") REFERENCES "public"."inventory_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_proposals" ADD CONSTRAINT "commercial_proposals_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_proposals" ADD CONSTRAINT "commercial_proposals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_proposals" ADD CONSTRAINT "commercial_proposals_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_booking_items_booking_id_idx" ON "commercial_booking_items" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "commercial_booking_items_proposal_item_id_idx" ON "commercial_booking_items" USING btree ("proposal_item_id");--> statement-breakpoint
CREATE INDEX "commercial_booking_items_inventory_reservation_id_idx" ON "commercial_booking_items" USING btree ("inventory_reservation_id");--> statement-breakpoint
CREATE INDEX "commercial_booking_items_deleted_at_idx" ON "commercial_booking_items" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_bookings_proposal_uidx" ON "commercial_bookings" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "commercial_bookings_advertiser_id_idx" ON "commercial_bookings" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "commercial_bookings_territory_id_idx" ON "commercial_bookings" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "commercial_bookings_status_idx" ON "commercial_bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commercial_bookings_deleted_at_idx" ON "commercial_bookings" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_production_requests_booking_item_uidx" ON "commercial_production_requests" USING btree ("booking_item_id");--> statement-breakpoint
CREATE INDEX "commercial_production_requests_booking_id_idx" ON "commercial_production_requests" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "commercial_production_requests_advertiser_id_idx" ON "commercial_production_requests" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "commercial_production_requests_status_idx" ON "commercial_production_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commercial_production_requests_deleted_at_idx" ON "commercial_production_requests" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "commercial_proposal_items_proposal_id_idx" ON "commercial_proposal_items" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "commercial_proposal_items_product_id_idx" ON "commercial_proposal_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "commercial_proposal_items_inventory_slot_id_idx" ON "commercial_proposal_items" USING btree ("inventory_slot_id");--> statement-breakpoint
CREATE INDEX "commercial_proposal_items_deleted_at_idx" ON "commercial_proposal_items" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "commercial_proposals_advertiser_id_idx" ON "commercial_proposals" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "commercial_proposals_opportunity_id_idx" ON "commercial_proposals" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "commercial_proposals_territory_id_idx" ON "commercial_proposals" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "commercial_proposals_status_idx" ON "commercial_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commercial_proposals_deleted_at_idx" ON "commercial_proposals" USING btree ("deleted_at");