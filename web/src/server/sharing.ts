import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { getDb, schema, type AppDb } from "./db/client";
import { HttpError } from "./http";
import type { Owner } from "./owner";
import type { TripDoc } from "@/domain/schema";
import { toPublicDoc } from "@/domain/privacy";

/* Share links, interest votes and rate limits (PLAN.md 4.3, 4.6; FR-21–23, NFR-04). */

const { trips, tripVersions, shareLinks, interestVotes, rateLimits } = schema;
type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function voterHash(voterKey: string) {
  // Production requires VOTER_HASH_SALT (checked in config.ts); the fallback is for local development only.
  return sha256(`${process.env.VOTER_HASH_SALT ?? "dev-salt"}:${voterKey}`);
}

export function limits() {
  return {
    perVoter: Number(process.env.RATE_LIMIT_PER_VOTER ?? 30),
    perLink: Number(process.env.RATE_LIMIT_PER_LINK ?? 300),
  };
}

async function lockOwnerTrip(tx: Tx, owner: Owner): Promise<string> {
  const r = await tx.select({ id: trips.id }).from(trips).where(eq(trips.ownerGithubId, owner.githubId)).orderBy(asc(trips.createdAt)).limit(1).for("update");
  if (!r[0]) throw new HttpError(404, "找不到行程");
  return r[0].id;
}

/* ---------- owner side ---------- */

export async function shareStatus(owner: Owner) {
  const db = await getDb();
  const r = await db
    .select({ active: shareLinks.active, createdAt: shareLinks.createdAt })
    .from(shareLinks)
    .innerJoin(trips, eq(trips.id, shareLinks.tripId))
    .where(and(eq(trips.ownerGithubId, owner.githubId), eq(shareLinks.active, true)))
    .limit(1);
  return r[0] ? { active: true, createdAt: r[0].createdAt.toISOString() } : { active: false as const };
}

/** Creates a new link and deactivates the previous one, under the trip row lock. The token is returned only here. */
export async function createShareLink(owner: Owner): Promise<{ token: string }> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  try {
    await db.transaction(async (tx) => {
      const tripId = await lockOwnerTrip(tx, owner);
      await tx.update(shareLinks).set({ active: false, deactivatedAt: sql`now()` }).where(and(eq(shareLinks.tripId, tripId), eq(shareLinks.active, true)));
      await tx.insert(shareLinks).values({ tripId, tokenHash: sha256(token) });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new HttpError(409, "分享連結正在更新，請再試一次");
    throw e;
  }
  return { token };
}

export async function deactivateShareLinks(owner: Owner) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const tripId = await lockOwnerTrip(tx, owner);
    await tx.update(shareLinks).set({ active: false, deactivatedAt: sql`now()` }).where(and(eq(shareLinks.tripId, tripId), eq(shareLinks.active, true)));
  });
}

/** Aggregate counts only; never nicknames or voter hashes (FR-22). */
export async function interestCounts(owner: Owner, currentDoc: TripDoc) {
  const db = await getDb();
  const rows = await db
    .select({ itemId: interestVotes.itemId, dayDate: interestVotes.dayDate, n: count() })
    .from(interestVotes)
    .innerJoin(trips, eq(trips.id, interestVotes.tripId))
    .where(eq(trips.ownerGithubId, owner.githubId))
    .groupBy(interestVotes.itemId, interestVotes.dayDate);
  const scheduled = new Map<string, string>();
  currentDoc.days.forEach((d) => d.items.forEach((i) => scheduled.set(`${i.id}|${d.date}`, i.name)));
  const allNames = new Map<string, string>();
  currentDoc.days.forEach((d) => d.items.forEach((i) => allNames.set(i.id, i.name)));
  currentDoc.attractionPool.forEach((p) => p.items.forEach((i) => allNames.set(i.id, i.name)));
  const current: { itemId: string; dayDate: string; name: string; count: number }[] = [];
  const moved: { itemId: string; dayDate: string; name: string; count: number }[] = [];
  for (const r of rows) {
    const key = `${r.itemId}|${r.dayDate}`;
    const row = { itemId: r.itemId, dayDate: r.dayDate, name: scheduled.get(key) ?? allNames.get(r.itemId) ?? r.itemId, count: Number(r.n) };
    (scheduled.has(key) ? current : moved).push(row);
  }
  const sort = (a: { dayDate: string }, b: { dayDate: string }) => a.dayDate.localeCompare(b.dayDate);
  return { current: current.sort(sort), moved: moved.sort(sort) };
}

/* ---------- public side ---------- */

async function resolveLink(db: AppDb | Tx, token: string) {
  if (!token || token.length > 100) return null;
  const r = await db
    .select({ linkId: shareLinks.id, tripId: shareLinks.tripId, active: shareLinks.active })
    .from(shareLinks)
    .where(eq(shareLinks.tokenHash, sha256(token)))
    .limit(1);
  return r[0]?.active ? r[0] : null;
}

async function currentDocOf(db: AppDb | Tx, tripId: string) {
  const r = await db
    .select({ doc: tripVersions.doc, versionNo: tripVersions.versionNo })
    .from(trips)
    .innerJoin(tripVersions, eq(tripVersions.id, trips.currentVersionId))
    .where(eq(trips.id, tripId))
    .limit(1);
  return r[0] ? { doc: r[0].doc as TripDoc, versionNo: r[0].versionNo } : null;
}

/** The only trip read available without a session; returns null for unknown or inactive tokens (FR-23). */
export async function getPublicTrip(token: string) {
  const db = await getDb();
  const link = await resolveLink(db, token);
  if (!link) return null;
  const cur = await currentDocOf(db, link.tripId);
  if (!cur) return null;
  return { doc: toPublicDoc(cur.doc), versionNo: cur.versionNo };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VoteInput = { voterKey: string; itemId: string; dayDate: string; nickname?: string };

function validateVoteInput(b: unknown, needNickname: boolean): VoteInput {
  const o = (b ?? {}) as Record<string, unknown>;
  const voterKey = typeof o.voterKey === "string" ? o.voterKey : "";
  if (!UUID_RE.test(voterKey)) throw new HttpError(400, "訪客識別碼格式不正確");
  const itemId = typeof o.itemId === "string" ? o.itemId : "";
  const dayDate = typeof o.dayDate === "string" ? o.dayDate : "";
  if (!itemId || itemId.length > 32 || !/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) throw new HttpError(400, "活動或日期格式不正確");
  let nickname: string | undefined;
  if (needNickname) {
    if (o.nickname !== undefined && typeof o.nickname !== "string") throw new HttpError(400, "暱稱格式不正確");
    const n = ((o.nickname as string | undefined) ?? "").trim();
    if ([...n].length > 20) throw new HttpError(400, "暱稱最多 20 個字");
    nickname = n || undefined;
  }
  return { voterKey, itemId, dayDate, nickname };
}

/** Atomic quota reservation: increments both counters and checks the returned values (PLAN.md 4.6, R8-02). */
async function reserveQuota(tx: Tx, tripId: string, linkId: string, vHash: string) {
  const window = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const bump = async (key: string) => {
    const r = await tx
      .insert(rateLimits)
      .values({ key, windowStart: window, count: 1, tripId })
      .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
      .returning({ count: rateLimits.count });
    return r[0].count;
  };
  const { perVoter, perLink } = limits();
  const v = await bump(`vote:voter:${vHash}`);
  const l = await bump(`vote:link:${linkId}`);
  if (v > perVoter || l > perLink) throw new HttpError(429, "操作太頻繁，請稍後再試");
}

/** Create or update a vote. New votes must match an item scheduled on that date in the current version. */
export async function submitVote(token: string, body: unknown) {
  const input = validateVoteInput(body, true);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const link = await resolveLink(tx, token);
    if (!link) throw new HttpError(404, "分享連結無效或已停用");
    const vHash = voterHash(input.voterKey);
    await reserveQuota(tx, link.tripId, link.linkId, vHash);
    const existing = await tx
      .select({ id: interestVotes.id })
      .from(interestVotes)
      .where(and(eq(interestVotes.tripId, link.tripId), eq(interestVotes.itemId, input.itemId), eq(interestVotes.dayDate, input.dayDate), eq(interestVotes.voterHash, vHash)))
      .limit(1);
    if (existing[0]) {
      await tx.update(interestVotes).set({ nickname: input.nickname ?? null, updatedAt: sql`now()` }).where(eq(interestVotes.id, existing[0].id));
      return { updated: true };
    }
    const cur = await currentDocOf(tx, link.tripId);
    const scheduled = cur?.doc.days.some((d) => d.date === input.dayDate && d.items.some((i) => i.id === input.itemId));
    if (!scheduled) throw new HttpError(400, "這個活動不在該日期的行程中");
    await tx
      .insert(interestVotes)
      .values({ tripId: link.tripId, shareLinkId: link.linkId, itemId: input.itemId, dayDate: input.dayDate, nickname: input.nickname ?? null, voterHash: vHash })
      .onConflictDoNothing();
    return { created: true };
  });
}

/** Withdraw must match an existing vote of this voter (404 otherwise). */
export async function withdrawVote(token: string, body: unknown) {
  const input = validateVoteInput(body, false);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const link = await resolveLink(tx, token);
    if (!link) throw new HttpError(404, "分享連結無效或已停用");
    const vHash = voterHash(input.voterKey);
    await reserveQuota(tx, link.tripId, link.linkId, vHash);
    const del = await tx
      .delete(interestVotes)
      .where(and(eq(interestVotes.tripId, link.tripId), eq(interestVotes.itemId, input.itemId), eq(interestVotes.dayDate, input.dayDate), eq(interestVotes.voterHash, vHash)))
      .returning({ id: interestVotes.id });
    if (!del.length) throw new HttpError(404, "找不到你的回應");
    return { withdrawn: true };
  });
}

/** The visitor's own responses (looked up by their voter key, sent in the body). */
export async function myVotes(token: string, body: unknown) {
  const o = (body ?? {}) as Record<string, unknown>;
  const voterKey = typeof o.voterKey === "string" ? o.voterKey : "";
  if (!UUID_RE.test(voterKey)) throw new HttpError(400, "訪客識別碼格式不正確");
  const db = await getDb();
  const link = await resolveLink(db, token);
  if (!link) throw new HttpError(404, "分享連結無效或已停用");
  const rows = await db
    .select({ itemId: interestVotes.itemId, dayDate: interestVotes.dayDate, nickname: interestVotes.nickname })
    .from(interestVotes)
    .where(and(eq(interestVotes.tripId, link.tripId), eq(interestVotes.voterHash, voterHash(voterKey))));
  return rows;
}
