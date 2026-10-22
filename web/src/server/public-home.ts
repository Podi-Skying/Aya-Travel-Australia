import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { ownerIds } from "./auth";
import { toPublicDoc } from "@/domain/privacy";
import type { TripDoc } from "@/domain/schema";

/*
 * Public home page (owner request, 2026-10-22): by default anyone can read the owner's
 * current trip at the site root through the same redacted view as share links; the owner
 * signs in with the button in the top-right corner. Set PUBLIC_HOME=0 to require sign-in.
 * Writes still require the owner session; votes still need a share link.
 */

export function publicHomeEnabled(): boolean {
  return process.env.PUBLIC_HOME?.trim() !== "0";
}

export async function getPublicHomeTrip() {
  if (!publicHomeEnabled()) return null;
  const owner = ownerIds()[0];
  if (!owner) return null;
  const db = await getDb();
  const { trips, tripVersions } = schema;
  const r = await db
    .select({ doc: tripVersions.doc, versionNo: tripVersions.versionNo })
    .from(trips)
    .innerJoin(tripVersions, eq(tripVersions.id, trips.currentVersionId))
    .where(eq(trips.ownerGithubId, owner))
    .orderBy(asc(trips.createdAt))
    .limit(1);
  if (!r[0]) return null;
  return { doc: toPublicDoc(r[0].doc as TripDoc), versionNo: r[0].versionNo };
}
