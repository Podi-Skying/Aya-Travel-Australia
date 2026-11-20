CREATE TABLE "photo_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"category" text NOT NULL,
	"day_date" text,
	"source" text DEFAULT 'local-claude' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_labels_print" UNIQUE("trip_id","fingerprint")
);
--> statement-breakpoint
ALTER TABLE "photo_labels" ADD CONSTRAINT "photo_labels_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;