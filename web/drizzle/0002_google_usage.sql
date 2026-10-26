CREATE TABLE "google_usage" (
	"day" text NOT NULL,
	"api" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "google_usage_day_api_pk" PRIMARY KEY("day","api")
);
