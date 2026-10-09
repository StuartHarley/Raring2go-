CREATE TABLE "advertiser_tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rate_bps" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_tax_rates_code_from_uidx" ON "advertiser_tax_rates" USING btree ("code","effective_from");--> statement-breakpoint
-- Standard UK rates, so a database that was migrated but never seeded can still invoice. The ids match the seed.
INSERT INTO "advertiser_tax_rates" ("id", "code", "description", "rate_bps", "effective_from") VALUES
	('00000000-0000-4000-8000-000000000761', 'standard_vat', 'UK standard rate VAT', 2000, '2011-01-04'),
	('00000000-0000-4000-8000-000000000762', 'zero_rated', 'Zero-rated', 0, '2011-01-04'),
	('00000000-0000-4000-8000-000000000763', 'exempt', 'Exempt', 0, '2011-01-04')
ON CONFLICT DO NOTHING;
