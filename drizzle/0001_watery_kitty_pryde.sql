ALTER TABLE "project_roles" DROP CONSTRAINT "project_roles_rate_nonneg";--> statement-breakpoint
ALTER TABLE "project_roles" DROP CONSTRAINT "project_roles_budget_nonneg";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "project_roles" ALTER COLUMN "rate_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "project_roles" ALTER COLUMN "budget_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "time_entries" ALTER COLUMN "invoiced_amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "workspace_settings" ALTER COLUMN "default_rate_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "workspace_settings" ALTER COLUMN "default_rate_cents" SET DEFAULT 12000;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_nonneg" CHECK ("invoices"."amount_cents" >= 0);--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_rate_range" CHECK ("project_roles"."rate_cents" between 0 and 100000000);--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_budget_range" CHECK ("project_roles"."budget_cents" between 0 and 1000000000000);--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_budget_minutes_range" CHECK ("project_roles"."budget_minutes" is null or "project_roles"."budget_minutes" between 0 and 10000000);--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoiced_amount_nonneg" CHECK ("time_entries"."invoiced_amount_cents" is null or "time_entries"."invoiced_amount_cents" >= 0);--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_default_rate_range" CHECK ("workspace_settings"."default_rate_cents" between 0 and 100000000);