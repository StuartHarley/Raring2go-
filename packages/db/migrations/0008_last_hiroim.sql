CREATE TABLE "franchise_onboarding_blockers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"task_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"raised_by_user_id" uuid,
	"resolved_by_user_id" uuid,
	"resolved_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchise_onboarding_programmes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"franchise_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"source_agreement_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"target_launch_date" date NOT NULL,
	"actual_launch_date" date,
	"launch_readiness" text DEFAULT 'not_ready' NOT NULL,
	"launch_approved_by_user_id" uuid,
	"launch_approved_at" date,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "franchise_onboarding_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"template_task_id" uuid,
	"phase_name" text NOT NULL,
	"title" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_user_id" uuid,
	"status" text DEFAULT 'not_started' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" date,
	"due_date" date,
	"due_date_overridden" boolean DEFAULT false NOT NULL,
	"completed_by_user_id" uuid,
	"completed_at" date,
	"evidence_document_id" uuid,
	"dependency_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"readiness_gate" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "onboarding_template_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "onboarding_template_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_type" text DEFAULT 'hq' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"due_rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dependency_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"readiness_gate" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "onboarding_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"readiness_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "onboarding_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "franchise_onboarding_blockers" ADD CONSTRAINT "franchise_onboarding_blockers_programme_id_franchise_onboarding_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."franchise_onboarding_programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_blockers" ADD CONSTRAINT "franchise_onboarding_blockers_task_id_franchise_onboarding_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."franchise_onboarding_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_blockers" ADD CONSTRAINT "franchise_onboarding_blockers_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_blockers" ADD CONSTRAINT "franchise_onboarding_blockers_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_programmes" ADD CONSTRAINT "franchise_onboarding_programmes_franchise_id_franchises_id_fk" FOREIGN KEY ("franchise_id") REFERENCES "public"."franchises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_programmes" ADD CONSTRAINT "franchise_onboarding_programmes_template_id_onboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_programmes" ADD CONSTRAINT "franchise_onboarding_programmes_source_agreement_id_franchise_agreements_id_fk" FOREIGN KEY ("source_agreement_id") REFERENCES "public"."franchise_agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_programmes" ADD CONSTRAINT "franchise_onboarding_programmes_launch_approved_by_user_id_users_id_fk" FOREIGN KEY ("launch_approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_tasks" ADD CONSTRAINT "franchise_onboarding_tasks_programme_id_franchise_onboarding_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."franchise_onboarding_programmes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_tasks" ADD CONSTRAINT "franchise_onboarding_tasks_template_task_id_onboarding_template_tasks_id_fk" FOREIGN KEY ("template_task_id") REFERENCES "public"."onboarding_template_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_tasks" ADD CONSTRAINT "franchise_onboarding_tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_tasks" ADD CONSTRAINT "franchise_onboarding_tasks_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_tasks" ADD CONSTRAINT "franchise_onboarding_tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_onboarding_tasks" ADD CONSTRAINT "franchise_onboarding_tasks_evidence_document_id_franchise_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."franchise_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_phases" ADD CONSTRAINT "onboarding_template_phases_template_id_onboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_phase_id_onboarding_template_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."onboarding_template_phases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "franchise_onboarding_blockers_programme_id_idx" ON "franchise_onboarding_blockers" USING btree ("programme_id");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_blockers_task_id_idx" ON "franchise_onboarding_blockers" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_blockers_status_idx" ON "franchise_onboarding_blockers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_blockers_deleted_at_idx" ON "franchise_onboarding_blockers" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_onboarding_programmes_idempotency_uidx" ON "franchise_onboarding_programmes" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_programmes_franchise_id_idx" ON "franchise_onboarding_programmes" USING btree ("franchise_id");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_programmes_status_idx" ON "franchise_onboarding_programmes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_programmes_target_launch_date_idx" ON "franchise_onboarding_programmes" USING btree ("target_launch_date");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_programmes_deleted_at_idx" ON "franchise_onboarding_programmes" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_tasks_programme_id_idx" ON "franchise_onboarding_tasks" USING btree ("programme_id");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_tasks_status_idx" ON "franchise_onboarding_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_tasks_due_date_idx" ON "franchise_onboarding_tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "franchise_onboarding_tasks_deleted_at_idx" ON "franchise_onboarding_tasks" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "onboarding_template_phases_template_id_idx" ON "onboarding_template_phases" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "onboarding_template_phases_sort_order_idx" ON "onboarding_template_phases" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "onboarding_template_phases_deleted_at_idx" ON "onboarding_template_phases" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "onboarding_template_tasks_phase_id_idx" ON "onboarding_template_tasks" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "onboarding_template_tasks_sort_order_idx" ON "onboarding_template_tasks" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "onboarding_template_tasks_deleted_at_idx" ON "onboarding_template_tasks" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "onboarding_templates_key_idx" ON "onboarding_templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX "onboarding_templates_status_idx" ON "onboarding_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "onboarding_templates_deleted_at_idx" ON "onboarding_templates" USING btree ("deleted_at");