CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "run_steps_run_id_node_id_pk" PRIMARY KEY("run_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"payload" jsonb,
	"graph" jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"graph" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"webhook_token" text NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_webhook_token_unique" UNIQUE("webhook_token")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "runs_workflow_idx" ON "runs" USING btree ("workflow_id","started_at");--> statement-breakpoint
CREATE INDEX "workflows_due_idx" ON "workflows" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "workflows_user_idx" ON "workflows" USING btree ("user_id");