import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type AppDb } from "./db/client";
import { HttpError } from "./http";
import type { Owner } from "./owner";
import { parseTripDoc, type TripDoc } from "@/domain/schema";
import { docRuleErrors } from "@/domain/effective-day";
import { applyOp, type Op } from "@/domain/ops";

/* Owner-side trip repository (PLAN.md 4.3). Every function requires a verified Owner. */

const { trips, tripVersions } = schema;

export type CurrentTrip = {
  tripId: string;
  title: string;
  versionNo: number;
  summary: string;
  createdAt: string;
  doc: TripDoc;
};

type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export async function findOwnerTripId(db: AppDb | Tx, owner: Owner): Promise<string | null> {
  const rows = await db.select({ id: trips.id }).from(trips).where(eq(trips.ownerGithubId, owner.githubId)).orderBy(asc(trips.createdAt)).limit(1);
  return rows[0]?.id ?? null;
}

export async function getCurrentTrip(owner: Owner): Promise<CurrentTrip | null> {
  const db = await getDb();
  const rows = await db
    .select({ tripId: trips.id, versionNo: tripVersions.versionNo, summary: tripVersions.summary, createdAt: tripVersions.createdAt, doc: tripVersions.doc })
    .from(trips)
    .innerJoin(tripVersions, eq(tripVersions.id, trips.currentVersionId))
    .where(eq(trips.ownerGithubId, owner.githubId))
    .orderBy(asc(trips.createdAt))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  const doc = r.doc as TripDoc;
  return { tripId: r.tripId, title: doc.meta.title, versionNo: r.versionNo, summary: r.summary, createdAt: r.createdAt.toISOString(), doc };
}

export async function listVersions(owner: Owner, opts: { withDocsRecent?: number } = {}) {
  const db = await getDb();
  const tripId = await findOwnerTripId(db, owner);
  if (!tripId) return [];
  const rows = await db
    .select({ versionNo: tripVersions.versionNo, summary: tripVersions.summary, createdAt: tripVersions.createdAt, restoredFrom: tripVersions.restoredFrom })
    .from(tripVersions)
    .where(eq(tripVersions.tripId, tripId))
    .orderBy(desc(tripVersions.versionNo));
  const n = opts.withDocsRecent ?? 0;
  const wanted = new Set(rows.slice(0, n).map((r) => r.versionNo));
  if (n > 0 && rows.length) wanted.add(1);
  const docs = new Map<number, TripDoc>();
  if (wanted.size) {
    const d = await db
      .select({ versionNo: tripVersions.versionNo, doc: tripVersions.doc })
      .from(tripVersions)
      .where(and(eq(tripVersions.tripId, tripId), inArray(tripVersions.versionNo, [...wanted])));
    d.forEach((x) => docs.set(x.versionNo, x.doc as TripDoc));
  }
  return rows.map((r) => ({
    versionNo: r.versionNo,
    summary: r.summary,
    createdAt: r.createdAt.toISOString(),
    restoredFrom: r.restoredFrom,
    ...(docs.has(r.versionNo) ? { doc: docs.get(r.versionNo) } : {}),
  }));
}

export async function getVersionDoc(owner: Owner, versionNo: number): Promise<TripDoc | null> {
  const db = await getDb();
  const tripId = await findOwnerTripId(db, owner);
  if (!tripId) return null;
  const r = await db
    .select({ doc: tripVersions.doc })
    .from(tripVersions)
    .where(and(eq(tripVersions.tripId, tripId), eq(tripVersions.versionNo, versionNo)))
    .limit(1);
  return (r[0]?.doc as TripDoc) ?? null;
}

export function validateDoc(input: unknown): TripDoc {
  const p = parseTripDoc(input);
  if (!p.ok) throw new HttpError(400, "行程資料格式不正確", { errors: p.errors });
  const rules = docRuleErrors(p.doc);
  if (rules.length) throw new HttpError(400, "行程資料不符合規則", { errors: rules });
  return p.doc;
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/**
 * Locks the owner's trip row, checks the base version and lets `build` produce
 * the next document. Concurrent writers are serialized by the row lock; a stale
 * base or a residual unique violation becomes HTTP 409 (PLAN.md 4.3, F-01).
 */
export async function writeVersion(
  owner: Owner,
  baseVersionNo: number,
  build: (current: TripDoc, tx: Tx) => Promise<{ doc: unknown; summary: string; restoredFrom?: number }>,
): Promise<{ versionNo: number; summary: string; doc: TripDoc }> {
  if (!Number.isInteger(baseVersionNo)) throw new HttpError(400, "缺少 baseVersionNo");
  const db = await getDb();
  try {
    return await db.transaction(async (tx) => {
      const tripRows = await tx
        .select({ id: trips.id, currentVersionId: trips.currentVersionId })
        .from(trips)
        .where(eq(trips.ownerGithubId, owner.githubId))
        .orderBy(asc(trips.createdAt))
        .limit(1)
        .for("update");
      const trip = tripRows[0];
      if (!trip?.currentVersionId) throw new HttpError(404, "找不到行程");
      const cur = (await tx.select().from(tripVersions).where(eq(tripVersions.id, trip.currentVersionId)).limit(1))[0];
      if (cur.versionNo !== baseVersionNo)
        throw new HttpError(409, "行程已在其他地方更新，請重新整理後再試", { currentVersionNo: cur.versionNo });
      const next = await build(cur.doc as TripDoc, tx);
      const doc = validateDoc(next.doc);
      const versionNo = cur.versionNo + 1;
      const inserted = await tx
        .insert(tripVersions)
        .values({ tripId: trip.id, versionNo, summary: next.summary.slice(0, 200), doc, createdBy: owner.githubId, restoredFrom: next.restoredFrom ?? null })
        .returning({ id: tripVersions.id });
      await tx.update(trips).set({ currentVersionId: inserted[0].id, updatedAt: sql`now()` }).where(eq(trips.id, trip.id));
      return { versionNo, summary: next.summary, doc };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, "行程已在其他地方更新，請重新整理後再試");
    throw e;
  }
}

export function applyOwnerOp(owner: Owner, baseVersionNo: number, op: Op) {
  return writeVersion(owner, baseVersionNo, async (current) => {
    const r = applyOp(current, op);
    if (!r.ok) throw new HttpError(r.status, r.error);
    return { doc: r.doc, summary: r.summary };
  });
}

export function restoreVersion(owner: Owner, baseVersionNo: number, versionNo: number) {
  return writeVersion(owner, baseVersionNo, async (_current, tx) => {
    const tripId = await findOwnerTripId(tx, owner);
    const r = await tx
      .select({ doc: tripVersions.doc, summary: tripVersions.summary })
      .from(tripVersions)
      .where(and(eq(tripVersions.tripId, tripId!), eq(tripVersions.versionNo, versionNo)))
      .limit(1);
    if (!r[0]) throw new HttpError(404, "找不到該版本");
    return { doc: r[0].doc, summary: `還原至 v${versionNo}（${r[0].summary}）`, restoredFrom: versionNo };
  });
}

export function importDoc(owner: Owner, baseVersionNo: number, doc: unknown) {
  return writeVersion(owner, baseVersionNo, async () => ({ doc, summary: "匯入" }));
}

/** FR-27: deletes the trip; versions, share links, votes and trip rate-limit rows cascade. */
export async function deleteTrip(owner: Owner, confirmTitle: string) {
  const db = await getDb();
  const cur = await getCurrentTrip(owner);
  if (!cur) throw new HttpError(404, "找不到行程");
  if (confirmTitle.trim() !== cur.title) throw new HttpError(400, "請輸入完整的行程名稱以確認刪除");
  await db.delete(trips).where(eq(trips.id, cur.tripId));
}

/** Creates the owner's trip with version 1 (seed). */
export async function createTrip(db: AppDb, ownerGithubId: string, doc: TripDoc, summary: string): Promise<string> {
  const valid = validateDoc(doc);
  return db.transaction(async (tx) => {
    const t = await tx.insert(trips).values({ ownerGithubId }).returning({ id: trips.id });
    const v = await tx
      .insert(tripVersions)
      .values({ tripId: t[0].id, versionNo: 1, summary, doc: valid, createdBy: "seed" })
      .returning({ id: tripVersions.id });
    await tx.update(trips).set({ currentVersionId: v[0].id }).where(eq(trips.id, t[0].id));
    return t[0].id;
  });
}
