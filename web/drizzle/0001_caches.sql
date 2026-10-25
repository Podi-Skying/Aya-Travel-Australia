CREATE TABLE "lookup_cache" (
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "lookup_cache_kind_key_pk" PRIMARY KEY("kind","key")
);
--> statement-breakpoint
CREATE TABLE "route_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_lat" double precision NOT NULL,
	"from_lng" double precision NOT NULL,
	"to_lat" double precision NOT NULL,
	"to_lng" double precision NOT NULL,
	"mode" text NOT NULL,
	"distance_m" integer NOT NULL,
	"duration_s" integer NOT NULL,
	"geometry" jsonb NOT NULL,
	"source" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_cache_pair" UNIQUE("from_lat","from_lng","to_lat","to_lng","mode")
);
