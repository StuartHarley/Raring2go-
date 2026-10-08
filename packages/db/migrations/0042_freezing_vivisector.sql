CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_key" text NOT NULL,
	"purpose" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider_key" text NOT NULL,
	"model_reference" text NOT NULL,
	"status" text NOT NULL,
	"risk" text DEFAULT 'low' NOT NULL,
	"approval_state" text DEFAULT 'not_required' NOT NULL,
	"actor_type" text DEFAULT 'human' NOT NULL,
	"actor_user_id" uuid,
	"organisation_id" uuid,
	"territory_id" uuid,
	"subject_type" text,
	"subject_id" text,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_minor" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_territory_id_territories_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."territories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_task_created_idx" ON "ai_runs" USING btree ("task_key","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_territory_id_idx" ON "ai_runs" USING btree ("territory_id");--> statement-breakpoint
CREATE INDEX "ai_runs_organisation_id_idx" ON "ai_runs" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "ai_runs_subject_idx" ON "ai_runs" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "ai_runs_approval_idx" ON "ai_runs" USING btree ("approval_state","created_at");