CREATE TYPE "public"."billing_method" AS ENUM('time_and_materials', 'fixed_fee', 'retainer');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('tentative', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."entry_source" AS ENUM('internal', 'portal');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('vacation', 'sick', 'unpaid', 'other');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner_admin', 'operations_lead', 'resource_manager', 'project_manager', 'finance', 'logger');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('booked', 'onboarded', 'over_commitment', 'slipped_work');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('on_track', 'at_risk', 'on_hold', 'done');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"project_role_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"minutes_per_day" integer NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"note" text,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_range_order" CHECK ("bookings"."end_date" >= "bookings"."start_date"),
	CONSTRAINT "bookings_minutes_sane" CHECK ("bookings"."minutes_per_day" > 0 and "bookings"."minutes_per_day" <= 1440)
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'var(--hue-2)' NOT NULL,
	"contact_email" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "holiday_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"region_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "holidays_calendar_date_unique" UNIQUE("calendar_id","holiday_date")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"issued_date" date NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"project_id" uuid,
	"amount_cents" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_reference_unique" UNIQUE("reference"),
	CONSTRAINT "invoices_period_order" CHECK ("invoices"."period_end" >= "invoices"."period_start")
);
--> statement-breakpoint
CREATE TABLE "leave" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"leave_type" "leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"minutes_per_day" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_range_order" CHECK ("leave"."end_date" >= "leave"."start_date"),
	CONSTRAINT "leave_minutes_sane" CHECK ("leave"."minutes_per_day" is null or ("leave"."minutes_per_day" > 0 and "leave"."minutes_per_day" <= 1440))
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'logger' NOT NULL,
	"working_minutes" jsonb NOT NULL,
	"contract_start" date NOT NULL,
	"contract_end" date,
	"utilization_target_pct" integer,
	"holiday_calendar_id" uuid,
	"portal_token" text NOT NULL,
	"pin_hash" text,
	"pin_salt" text,
	"portal_revoked" boolean DEFAULT false NOT NULL,
	"pin_failed_count" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp with time zone,
	"color" text DEFAULT 'var(--hue-1)' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_email_unique" UNIQUE("email"),
	CONSTRAINT "members_portal_token_unique" UNIQUE("portal_token"),
	CONSTRAINT "members_target_range" CHECK ("members"."utilization_target_pct" is null or "members"."utilization_target_pct" between 0 and 100),
	CONSTRAINT "members_contract_order" CHECK ("members"."contract_end" is null or "members"."contract_end" >= "members"."contract_start")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_health_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"update_date" date NOT NULL,
	"status" "project_status" NOT NULL,
	"risk" "risk_level" NOT NULL,
	"satisfaction" integer,
	"comment" text,
	"author_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_health_satisfaction_range" CHECK ("project_health_updates"."satisfaction" is null or "project_health_updates"."satisfaction" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "project_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate_cents" integer NOT NULL,
	"budget_cents" integer DEFAULT 0 NOT NULL,
	"budget_minutes" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_roles_name_unique" UNIQUE("project_id","name"),
	CONSTRAINT "project_roles_rate_nonneg" CHECK ("project_roles"."rate_cents" >= 0),
	CONSTRAINT "project_roles_budget_nonneg" CHECK ("project_roles"."budget_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"color" text DEFAULT 'var(--hue-3)' NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"billing_method" "billing_method" DEFAULT 'time_and_materials' NOT NULL,
	"start_date" date,
	"end_date" date,
	"owner_member_id" uuid,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code"),
	CONSTRAINT "projects_date_order" CHECK ("projects"."end_date" is null or "projects"."start_date" is null or "projects"."end_date" >= "projects"."start_date")
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_role_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignments_unique" UNIQUE("project_role_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"panel" text NOT NULL,
	"config" jsonb NOT NULL,
	"owner_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_panel_name_unique" UNIQUE("panel","name")
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"project_role_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"invoice_id" uuid,
	"invoiced_amount_cents" integer,
	"source" "entry_source" DEFAULT 'internal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_cell_unique" UNIQUE("member_id","project_role_id","entry_date"),
	CONSTRAINT "time_entries_minutes_positive" CHECK ("time_entries"."minutes" > 0),
	CONSTRAINT "time_entries_minutes_max" CHECK ("time_entries"."minutes" <= 1440),
	CONSTRAINT "time_entries_invoiced_amount_pairs" CHECK (("time_entries"."invoice_id" is null) = ("time_entries"."invoiced_amount_cents" is null))
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_name" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"date_format" text DEFAULT 'dd/MM/yyyy' NOT NULL,
	"week_start_day" integer DEFAULT 1 NOT NULL,
	"default_rate_cents" integer DEFAULT 12000 NOT NULL,
	"default_billing_method" "billing_method" DEFAULT 'time_and_materials' NOT NULL,
	"default_billable" boolean DEFAULT true NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_settings_singleton" CHECK ("workspace_settings"."id" = 'default'),
	CONSTRAINT "workspace_week_start_valid" CHECK ("workspace_settings"."week_start_day" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_project_role_id_project_roles_id_fk" FOREIGN KEY ("project_role_id") REFERENCES "public"."project_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_member_id_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_id_holiday_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."holiday_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave" ADD CONSTRAINT "leave_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_holiday_calendar_id_holiday_calendars_id_fk" FOREIGN KEY ("holiday_calendar_id") REFERENCES "public"."holiday_calendars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_health_updates" ADD CONSTRAINT "project_health_updates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_health_updates" ADD CONSTRAINT "project_health_updates_author_member_id_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_project_role_id_project_roles_id_fk" FOREIGN KEY ("project_role_id") REFERENCES "public"."project_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_member_id_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_role_id_project_roles_id_fk" FOREIGN KEY ("project_role_id") REFERENCES "public"."project_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_member_range_idx" ON "bookings" USING btree ("member_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "bookings_role_idx" ON "bookings" USING btree ("project_role_id");--> statement-breakpoint
CREATE INDEX "holidays_calendar_date_idx" ON "holidays" USING btree ("calendar_id","holiday_date");--> statement-breakpoint
CREATE INDEX "invoices_project_idx" ON "invoices" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "leave_member_range_idx" ON "leave" USING btree ("member_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "members_archived_idx" ON "members" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "notifications_member_idx" ON "notifications" USING btree ("member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "project_health_project_idx" ON "project_health_updates" USING btree ("project_id","update_date");--> statement-breakpoint
CREATE INDEX "project_roles_project_idx" ON "project_roles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_client_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_archived_idx" ON "projects" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "role_assignments_member_idx" ON "role_assignments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "time_entries_member_date_idx" ON "time_entries" USING btree ("member_id","entry_date");--> statement-breakpoint
CREATE INDEX "time_entries_role_date_idx" ON "time_entries" USING btree ("project_role_id","entry_date");--> statement-breakpoint
CREATE INDEX "time_entries_date_idx" ON "time_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "time_entries_invoice_idx" ON "time_entries" USING btree ("invoice_id");