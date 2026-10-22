import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
