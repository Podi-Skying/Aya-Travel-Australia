ALTER TABLE "trip_photos" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_print" UNIQUE("trip_id","fingerprint");