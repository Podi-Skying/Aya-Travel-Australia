ALTER TABLE "trip_photos" ADD COLUMN "media_type" text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD COLUMN "video_path" text;--> statement-breakpoint
ALTER TABLE "trip_photos" ADD COLUMN "duration_ms" integer;