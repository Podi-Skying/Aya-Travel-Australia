import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/* PLAN.md 4.3. Versions are append-only snapshots of the whole trip document. */

export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerGithubId: text("owner_github_id").notNull(),
  currentVersionId: uuid("current_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tripVersions = pgTable(
  "trip_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    summary: text("summary").notNull(),
    doc: jsonb("doc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by"),
    restoredFrom: integer("restored_from"),
  },
  (t) => [unique("trip_versions_trip_version").on(t.tripId, t.versionNo)],
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("share_links_one_active").on(t.tripId).where(sql`${t.active}`)],
);

export const interestVotes = pgTable(
  "interest_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    shareLinkId: uuid("share_link_id")
      .notNull()
      .references(() => shareLinks.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    dayDate: text("day_date").notNull(),
    nickname: text("nickname"),
    voterHash: text("voter_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("interest_votes_identity").on(t.tripId, t.itemId, t.dayDate, t.voterHash), index("interest_votes_trip").on(t.tripId)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/*
 * Caches (PLAN-2026-10-26 §2). Not tied to a trip: coordinates are already public in guest
 * documents, and lookups are about places, not people. Rows are reused instead of recomputed.
 */
export const routeCache = pgTable(
  "route_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromLat: doublePrecision("from_lat").notNull(),
    fromLng: doublePrecision("from_lng").notNull(),
    toLat: doublePrecision("to_lat").notNull(),
    toLng: doublePrecision("to_lng").notNull(),
    mode: text("mode").notNull(),
    distanceM: integer("distance_m").notNull(),
    durationS: integer("duration_s").notNull(),
    geometry: jsonb("geometry").notNull(),
    source: text("source").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("route_cache_pair").on(t.fromLat, t.fromLng, t.toLat, t.toLng, t.mode)],
);

export const lookupCache = pgTable(
  "lookup_cache",
  {
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.kind, t.key] })],
);

/* Google Maps Platform calls per Hobart day and API (docs/PLAN-2026-10-26-google.md). Numbers only. */
export const googleUsage = pgTable(
  "google_usage",
  {
    day: text("day").notNull(),
    api: text("api").notNull(),
    calls: integer("calls").notNull().default(0),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.api] })],
);

/* Kai's own photos (docs/PHOTOS-PLAN.md). Bytes live in a private Vercel Blob store; these rows hold paths and sorting only. */
export const tripPhotos = pgTable(
  "trip_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    displayPath: text("display_path").notNull(),
    thumbPath: text("thumb_path").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sha256: text("sha256").notNull(),
    /** 'size:sha256' of the first, middle and last 64 KB of the original file (src/domain/photo-sort.ts). */
    fingerprint: text("fingerprint"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    takenLocal: text("taken_local"),
    timeSource: text("time_source").notNull(),
    dayDate: text("day_date"),
    itemId: text("item_id"),
    manual: boolean("manual").notNull().default(false),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    caption: text("caption"),
    /** One of CATEGORIES in src/domain/photo-sort.ts, or null until classified. */
    category: text("category"),
    fileName: text("file_name").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("trip_photos_sha").on(t.tripId, t.sha256), unique("trip_photos_print").on(t.tripId, t.fingerprint), index("trip_photos_day").on(t.tripId, t.dayDate, t.takenLocal)],
);

/* Categories (and an optional day) that Claude on Kai's Mac gave a photo, keyed by its fingerprint; applied on upload. */
export const photoLabels = pgTable(
  "photo_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    category: text("category").notNull(),
    dayDate: text("day_date"),
    source: text("source").notNull().default("local-claude"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("photo_labels_print").on(t.tripId, t.fingerprint)],
);

/* Accounts allowed to see the photos: a GitHub numeric id or a lower-cased email. */
export const photoViewers = pgTable(
  "photo_viewers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    label: text("label").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("photo_viewers_entry").on(t.tripId, t.kind, t.value)],
);

/* Revocable viewer links; only the token's sha256 is stored. */
export const photoLinks = pgTable("photo_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
