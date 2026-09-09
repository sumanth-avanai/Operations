CREATE TYPE "public"."leave_portion" AS ENUM('full', 'half');--> statement-breakpoint
ALTER TABLE "leave" DROP CONSTRAINT "leave_minutes_sane";--> statement-breakpoint
ALTER TABLE "leave" ADD COLUMN "portion" "leave_portion" DEFAULT 'full' NOT NULL;--> statement-breakpoint
UPDATE "leave" SET "portion" = 'half' WHERE "minutes_per_day" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "leave" DROP COLUMN "minutes_per_day";
