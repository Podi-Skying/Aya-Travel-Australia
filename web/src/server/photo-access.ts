import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { photoViewersEnabled } from "./auth";
import { checkOwner, type Owner } from "./owner";
import { getSessionIdentity } from "./session";
import { sha256 } from "./sharing";

/*
 * Who may see Kai's own photos (docs/PHOTOS-PLAN.md): the owner; and, only with PHOTO_VIEWERS=1, a signed-in
 * allowlisted account or the holder of an active viewer link (cookie). Guests and trip share links: null.
 */

const { trips, photoViewers, photoLinks } = schema;

export const VIEWER_COOKIE = "aya_photos";

export type PhotoAccess = { kind: "owner"; owner: Owner; tripId: string } | { kind: "viewer"; tripId: string };

/** The site has one trip; viewers and links point at it. */
async function siteTripId(): Promise<string | null> {
  const db = await getDb();
  const r = await db.select({ id: trips.id }).from(trips).orderBy(asc(trips.createdAt)).limit(1);
  return r[0]?.id ?? null;
}

async function ownerTripId(owner: Owner): Promise<string | null> {
  const db = await getDb();
  const r = await db.select({ id: trips.id }).from(trips).where(eq(trips.ownerGithubId, owner.githubId)).orderBy(asc(trips.createdAt)).limit(1);
  return r[0]?.id ?? null;
}

export async function isAllowlisted(who: { githubId: string | null; email: string | null }): Promise<boolean> {
  return !!(await allowlistedTrip(who));
}

async function allowlistedTrip(who: { githubId: string | null; email: string | null }): Promise<string | null> {
  const db = await getDb();
  const tries: [string, string][] = [];
  if (who.githubId) tries.push(["github", who.githubId]);
  if (who.email) tries.push(["email", who.email.toLowerCase()]);
  for (const [kind, value] of tries) {
    const r = await db.select({ tripId: photoViewers.tripId }).from(photoViewers).where(and(eq(photoViewers.kind, kind), eq(photoViewers.value, value))).limit(1);
    if (r[0]) return r[0].tripId;
  }
  return null;
}

export async function linkTrip(token: string | null | undefined): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const db = await getDb();
  const r = await db.select({ tripId: photoLinks.tripId }).from(photoLinks).where(and(eq(photoLinks.tokenHash, sha256(token)), eq(photoLinks.active, true))).limit(1);
  return r[0]?.tripId ?? null;
}

export function readCookie(req: Request | null, name: string): string | null {
  const raw = req?.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Access for a request (route handlers) or, with `cookieValue`, for a server page. */
export async function photoAccess(req: Request | null, cookieValue?: string | null): Promise<PhotoAccess | null> {
  const c = await checkOwner();
  if (c.ok) {
    const tripId = await ownerTripId(c.owner);
    return tripId ? { kind: "owner", owner: c.owner, tripId } : null;
  }
  if (!photoViewersEnabled()) return null;
  const who = await getSessionIdentity();
  if (who.githubId || who.email) {
    const t = await allowlistedTrip(who);
    if (t) return { kind: "viewer", tripId: t };
  }
  const t = await linkTrip(cookieValue ?? readCookie(req, VIEWER_COOKIE));
  return t ? { kind: "viewer", tripId: t } : null;
}

/* ---------- owner: allowlist and links ---------- */

export async function listViewers(owner: Owner) {
  const tripId = await ownerTripId(owner);
  if (!tripId) return { viewers: [], links: [] };
  const db = await getDb();
  const viewers = await db
    .select({ id: photoViewers.id, kind: photoViewers.kind, value: photoViewers.value, label: photoViewers.label, createdAt: photoViewers.createdAt })
    .from(photoViewers)
    .where(eq(photoViewers.tripId, tripId))
    .orderBy(asc(photoViewers.createdAt));
  const links = await db
    .select({ id: photoLinks.id, label: photoLinks.label, active: photoLinks.active, createdAt: photoLinks.createdAt, revokedAt: photoLinks.revokedAt })
    .from(photoLinks)
    .where(eq(photoLinks.tripId, tripId))
    .orderBy(asc(photoLinks.createdAt));
  return { viewers, links };
}

export async function addViewer(owner: Owner, kind: "github" | "email", value: string, label: string) {
  const tripId = await ownerTripId(owner);
  if (!tripId) return null;
  const db = await getDb();
  const v = kind === "email" ? value.trim().toLowerCase() : value.trim();
  await db.insert(photoViewers).values({ tripId, kind, value: v, label }).onConflictDoUpdate({ target: [photoViewers.tripId, photoViewers.kind, photoViewers.value], set: { label } });
  return { kind, value: v };
}

export async function removeViewer(owner: Owner, id: string) {
  const tripId = await ownerTripId(owner);
  if (!tripId) return;
  const db = await getDb();
  await db.delete(photoViewers).where(and(eq(photoViewers.id, id), eq(photoViewers.tripId, tripId)));
}

/** A new viewer link; the raw token is returned once and only its hash is stored. */
export async function createLink(owner: Owner, label: string): Promise<{ id: string; token: string } | null> {
  const tripId = await ownerTripId(owner);
  if (!tripId) return null;
  const token = randomBytes(32).toString("base64url");
  const db = await getDb();
  const r = await db.insert(photoLinks).values({ tripId, tokenHash: sha256(token), label }).returning({ id: photoLinks.id });
  return { id: r[0].id, token };
}

export async function revokeLink(owner: Owner, id: string) {
  const tripId = await ownerTripId(owner);
  if (!tripId) return;
  const db = await getDb();
  await db.update(photoLinks).set({ active: false, revokedAt: new Date() }).where(and(eq(photoLinks.id, id), eq(photoLinks.tripId, tripId)));
}

export { siteTripId };
