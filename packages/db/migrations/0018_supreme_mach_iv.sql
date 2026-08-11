CREATE TABLE "commercial_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commercial_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"requires_inventory" boolean DEFAULT false NOT NULL,
	"requires_artwork" boolean DEFAULT false NOT NULL,
	"tax_code" text DEFAULT 'standard_vat' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_slot_id" uuid NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"status" text DEFAULT 'reserved' NOT NULL,
	"reserved_by_user_id" uuid,
	"expires_on" date,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"territory_edition_id" uuid,
	"edition_page_id" uuid,
	"territory_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"slot_key" text NOT NULL,
	"inventory_class" text NOT NULL,
	"exclusive" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_book_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"standard_price_minor" integer NOT NULL,
	"minimum_price_minor" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"approval_required_below_minor" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"territory_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_inventory_slot_id_inventory_slots_id_fk" FOREIGN KEY ("inventory_slot_id") REFERENCES "public"."inventory_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_reserved_by_user_id_users_id_fk" FOREIGN KEY ("reserved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_slots" ADD CONSTRAINT "inventory_slots_territory_edition_id_territory_editions_id_fk" FOREIGN KEY ("territory_edition_id") REFERENCES "public"."territory_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_slots" ADD CONSTRAINT "inventory_slots_edition_page_id_edition_pages_id_fk" FOREIGN KEY ("edition_page_id") REFERENCES "public"."edition_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_slots" ADD CONSTRAINT "inventory_slots_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_slots" ADD CONSTRAINT "inventory_slots_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_product_id_commercial_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."commercial_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_packages_key_uidx" ON "commercial_packages" USING btree ("key");--> statement-breakpoint
CREATE INDEX "commercial_packages_deleted_at_idx" ON "commercial_packages" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_products_key_uidx" ON "commercial_products" USING btree ("key");--> statement-breakpoint
CREATE INDEX "commercial_products_channel_idx" ON "commercial_products" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "commercial_products_deleted_at_idx" ON "commercial_products" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "inventory_reservations_slot_id_idx" ON "inventory_reservations" USING btree ("inventory_slot_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_advertiser_id_idx" ON "inventory_reservations" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_status_idx" ON "inventory_reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inventory_reservations_deleted_at_idx" ON "inventory_reservations" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_slots_slot_uidx" ON "inventory_slots" USING btree ("territory_edition_id","slot_key");--> statement-breakpoint
CREATE INDEX "inventory_slots_territory_id_idx" ON "inventory_slots" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "inventory_slots_product_id_idx" ON "inventory_slots" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_slots_status_idx" ON "inventory_slots" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inventory_slots_deleted_at_idx" ON "inventory_slots" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_book_items_book_product_uidx" ON "price_book_items" USING btree ("price_book_id","product_id");--> statement-breakpoint
CREATE INDEX "price_book_items_product_id_idx" ON "price_book_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "price_book_items_deleted_at_idx" ON "price_book_items" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_books_key_uidx" ON "price_books" USING btree ("key");--> statement-breakpoint
CREATE INDEX "price_books_territory_id_idx" ON "price_books" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "price_books_deleted_at_idx" ON "price_books" USING btree ("deleted_at");