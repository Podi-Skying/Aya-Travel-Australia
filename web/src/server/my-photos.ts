import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./db/client";
import { HttpError } from "./http";
import type { Owner } from "./owner";
import type { PhotoAccess } from "./photo-access";
import { getCurrentTrip } from "./trips";
import { blobConfigured, blobInfo, deleteBlobs, putJpeg, readBlob, readJpeg, signedReadUrl } from "./photo-blob";
import { dayFor, exifLocal, fileNameLocal, itemFor, type TimeSource } from "@/domain/photo-day";
import { CATEGORIES, FINGERPRINT, isCategory, isScreenshotName, SCREENSHOT } from "@/domain/photo-sort";
import type { TripDoc } from "@/domain/schema";
import { toPublicDoc } from "@/domain/privacy";
import { fitsStorage, MAX_VIDEO_BYTES, storageCaps, STORAGE_LIMIT_BYTES, VIDEO_PATH, VIDEO_TYPES } from "@/domain/video";

/* Kai's own photos (docs/PHOTOS-PLAN.md): rows in Neon, bytes in the private Blob store. */

const { tripPhotos, photoLabels } = schema;

export const MAX_DISPLAY = 3_000_000;
export const MAX_THUMB = 300_000;
/** Uploads stop at 90 % of the Blob store (src/domain/media.ts), so it is never locked for 30 days. */
export const QUOTA_BYTES = storageCaps().refuse;

export type MyPhoto = { id: string; w: number; h: number; dayDate: string | null; itemId: string | null; takenLocal: string | null; caption: string | null; category: string | null; video?: true; durationMs?: number | null; lat?: number | null; lng?: number | null; fileName?: string; manual?: boolean };

export const uploadMeta = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  fingerprint: z.string().regex(FINGERPRINT).nullish(),
  category: z.enum(CATEGORIES).nullish(),
  fileName: z.string().min(1).max(200),
  exifTime: z.string().max(40).nullish(),
  exifOffset: z.string().max(10).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
});
export type UploadMeta = z.infer<typeof uploadMeta>;

/** A video: the poster frame goes up like a photo, the video itself is already in the store at `videoPath`. */
export const videoMeta = uploadMeta.extend({ videoPath: z.string().regex(VIDEO_PATH), durationMs: z.number().int().min(0).max(24 * 3600_000).nullish() });
export type VideoMeta = z.infer<typeof videoMeta>;

/** What the browser says before it puts a video in the store. */
export const videoTokenPayload = z.object({ bytes: z.number().int().min(1).max(MAX_VIDEO_BYTES) }).strict();

export const patchBody = z
  .object({
    dayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    itemId: z.string().max(80).nullable().optional(),
    caption: z.string().max(200).optional(),
    category: z.enum(CATEGORIES).nullable().optional(),
  })
  .strict();

export const categoriesBody = z.object({ items: z.array(z.object({ id: z.string().uuid(), category: z.enum(CATEGORIES) }).strict()).min(1).max(500) }).strict();
export const checkBody = z.object({ fingerprints: z.array(z.string().regex(FINGERPRINT)).max(2000) }).strict();

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * Where a photo goes, decided on the server from its time and the current trip. Screenshots keep their
 * time but wait in 未分類 (a screenshot of a booking is rarely a photo of that day).
 */
export function placePhoto(meta: Pick<UploadMeta, "exifTime" | "exifOffset" | "fileName" | "lat" | "lng"> & { category?: UploadMeta["category"] }, doc: Pick<TripDoc, "days">) {
  const ex = exifLocal(meta.exifTime, meta.exifOffset);
  const fn = ex ? null : fileNameLocal(meta.fileName);
  const local = ex?.local ?? fn?.local ?? null;
  const timeSource: TimeSource = ex ? "exif" : fn ? "filename" : "none";
  const screenshot = isScreenshotName(meta.fileName);
  const dayDate = screenshot ? null : dayFor(local, doc.days);
  const day = dayDate ? doc.days.find((d) => d.date === dayDate) : undefined;
  const pos = meta.lat != null && meta.lng != null ? { lat: meta.lat, lng: meta.lng } : null;
  const itemId = day ? itemFor(local, day.items, pos) : null;
  return { takenLocal: local, takenAt: ex?.at ? new Date(ex.at) : null, timeSource, dayDate, itemId, category: screenshot ? SCREENSHOT : (meta.category ?? null) };
}

function view(r: typeof tripPhotos.$inferSelect, owner: boolean): MyPhoto {
  const base: MyPhoto = { id: r.id, w: r.width, h: r.height, dayDate: r.dayDate, itemId: r.itemId, takenLocal: r.takenLocal, caption: r.caption, category: r.category };
  if (r.mediaType === "video") Object.assign(base, { video: true, durationMs: r.durationMs });
  return owner ? { ...base, lat: r.lat, lng: r.lng, fileName: r.fileName, manual: r.manual } : base;
}

export async function usedBytes(tripId: string): Promise<number> {
  const db = await getDb();
  const r = await db.select({ n: sql<number>`coalesce(sum(${tripPhotos.bytes}), 0)::bigint` }).from(tripPhotos).where(eq(tripPhotos.tripId, tripId));
  return Number(r[0]?.n ?? 0);
}

export async function listPhotos(access: PhotoAccess) {
  const db = await getDb();
  const rows = await db.select().from(tripPhotos).where(eq(tripPhotos.tripId, access.tripId)).orderBy(asc(tripPhotos.dayDate), asc(tripPhotos.takenLocal), asc(tripPhotos.createdAt));
  const owner = access.kind === "owner";
  // Viewers see sorted photos only; 未分類 is the owner's inbox.
  const photos = rows.filter((r) => owner || r.dayDate).map((r) => view(r, owner));
  return { configured: blobConfigured(), photos, ...(owner ? { usedBytes: await usedBytes(access.tripId), quotaBytes: QUOTA_BYTES, limitBytes: STORAGE_LIMIT_BYTES } : {}) };
}

export function uploadPhoto(owner: Owner, tripId: string, display: Uint8Array, thumb: Uint8Array, meta: UploadMeta): Promise<{ photo: MyPhoto; duplicate: boolean }> {
  return storeMedia(owner, tripId, display, thumb, meta, null);
}

const FULL = "空間快滿了，這個檔案放不下（上限 900 MB，免費方案 1 GB）";

/**
 * Finishes a video the browser already put in the store: checks the file is there, is a video, is the size
 * the store reports and still fits; otherwise the file is deleted again. The poster frame is stored like a photo.
 */
export async function uploadVideo(owner: Owner, tripId: string, poster: Uint8Array, thumb: Uint8Array, meta: VideoMeta): Promise<{ photo: MyPhoto; duplicate: boolean }> {
  if (!blobConfigured()) throw new HttpError(503, "照片儲存空間還沒設定");
  const db = await getDb();
  const taken = await db.select({ id: tripPhotos.id }).from(tripPhotos).where(eq(tripPhotos.videoPath, meta.videoPath)).limit(1);
  if (taken[0]) throw new HttpError(409, "這支影片已經存過");
  const info = await blobInfo(meta.videoPath);
  if (!info) throw new HttpError(400, "找不到上傳的影片，請再試一次");
  const drop = () => deleteBlobs([meta.videoPath]).catch(() => {});
  if (!(VIDEO_TYPES as readonly string[]).includes(info.contentType.split(";")[0]) || info.size > MAX_VIDEO_BYTES) {
    await drop();
    throw new HttpError(415, "只接受 MP4、MOV 或 WebM 影片");
  }
  try {
    const r = await storeMedia(owner, tripId, poster, thumb, meta, { path: meta.videoPath, bytes: info.size, durationMs: meta.durationMs ?? null });
    if (r.duplicate) await drop();
    return r;
  } catch (e) {
    await drop();
    throw e;
  }
}

async function storeMedia(owner: Owner, tripId: string, display: Uint8Array, thumb: Uint8Array, meta: UploadMeta, video: { path: string; bytes: number; durationMs: number | null } | null): Promise<{ photo: MyPhoto; duplicate: boolean }> {
  if (!blobConfigured()) throw new HttpError(503, "照片儲存空間還沒設定");
  if (!isJpeg(display) || !isJpeg(thumb)) throw new HttpError(415, "只接受 JPEG");
  if (display.length > MAX_DISPLAY || thumb.length > MAX_THUMB) throw new HttpError(413, "照片太大");
  const db = await getDb();
  const dup = await findDuplicate(tripId, meta);
  if (dup) return { photo: view(dup, true), duplicate: true };
  if (!fitsStorage(await usedBytes(tripId), display.length + thumb.length + (video?.bytes ?? 0))) throw new HttpError(507, FULL);
  const trip = await getCurrentTrip(owner);
  const doc = trip?.doc ?? { days: [] };
  const place = placePhoto(meta, doc);
  /* a label from Claude on Kai's Mac fills in what the upload did not say */
  const label = meta.fingerprint ? (await db.select().from(photoLabels).where(and(eq(photoLabels.tripId, tripId), eq(photoLabels.fingerprint, meta.fingerprint))).limit(1))[0] : undefined;
  if (label) {
    if (!place.category && isCategory(label.category)) place.category = label.category;
    const day = label.dayDate ? doc.days.find((d) => d.date === label.dayDate) : undefined;
    if (day && place.category !== SCREENSHOT) {
      place.dayDate = day.date;
      place.itemId = itemFor(place.takenLocal, day.items, meta.lat != null && meta.lng != null ? { lat: meta.lat, lng: meta.lng } : null);
    }
  }
  const id = randomUUID();
  const paths: string[] = [];
  try {
    paths.push(await putJpeg(`trip-photos/${id}/display.jpg`, display));
    paths.push(await putJpeg(`trip-photos/${id}/thumb.jpg`, thumb));
    const r = await db
      .insert(tripPhotos)
      .values({
        id,
        tripId,
        displayPath: paths[0],
        thumbPath: paths[1],
        bytes: display.length + thumb.length + (video?.bytes ?? 0),
        ...(video ? { mediaType: "video", videoPath: video.path, durationMs: video.durationMs } : {}),
        width: meta.width,
        height: meta.height,
        sha256: meta.sha256,
        fingerprint: meta.fingerprint ?? null,
        ...place,
        lat: meta.lat ?? null,
        lng: meta.lng ?? null,
        fileName: meta.fileName,
        uploadedBy: owner.githubId,
      })
      .onConflictDoNothing()
      .returning();
    if (r[0]) return { photo: view(r[0], true), duplicate: false };
    // The same photo finished in a parallel request: keep that one.
    await deleteBlobs(paths).catch(() => {});
    const again = await findDuplicate(tripId, meta);
    if (!again) throw new HttpError(409, "請再試一次");
    return { photo: view(again, true), duplicate: true };
  } catch (e) {
    await deleteBlobs(paths).catch(() => {});
    throw e;
  }
}

/** The same photo already stored: equal full-file hash, or equal fingerprint when the client sent one. */
async function findDuplicate(tripId: string, meta: Pick<UploadMeta, "sha256" | "fingerprint">) {
  const db = await getDb();
  const bySha = await db.select().from(tripPhotos).where(and(eq(tripPhotos.tripId, tripId), eq(tripPhotos.sha256, meta.sha256))).limit(1);
  if (bySha[0] || !meta.fingerprint) return bySha[0];
  const byPrint = await db.select().from(tripPhotos).where(and(eq(tripPhotos.tripId, tripId), eq(tripPhotos.fingerprint, meta.fingerprint))).limit(1);
  return byPrint[0];
}

/** Which of these fingerprints are already stored, so the sorting stage marks them 重複 before uploading. */
export async function knownFingerprints(tripId: string, prints: string[]): Promise<string[]> {
  if (!prints.length) return [];
  const db = await getDb();
  const r = await db
    .select({ f: tripPhotos.fingerprint })
    .from(tripPhotos)
    .where(and(eq(tripPhotos.tripId, tripId), inArray(tripPhotos.fingerprint, [...new Set(prints)])));
  return r.map((x) => x.f!).filter(Boolean);
}

/** Labels Claude made on Kai's Mac, by fingerprint, for the sorting stage to show before upload. */
export async function labelsFor(tripId: string, prints: string[]): Promise<Record<string, string>> {
  if (!prints.length) return {};
  const db = await getDb();
  const r = await db
    .select({ f: photoLabels.fingerprint, c: photoLabels.category })
    .from(photoLabels)
    .where(and(eq(photoLabels.tripId, tripId), inArray(photoLabels.fingerprint, [...new Set(prints)])));
  return Object.fromEntries(r.map((x) => [x.f, x.c]));
}

export const labelInput = z.array(z.object({ fingerprint: z.string().regex(FINGERPRINT), category: z.enum(CATEGORIES), dayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }).strict()).max(5000);

/**
 * Stores labels from the local classify script and back-fills photos already uploaded with the same
 * fingerprint (category always when empty; the day only for photos never moved by hand).
 */
export async function saveLabels(tripId: string, days: { date: string }[], labels: z.infer<typeof labelInput>): Promise<{ saved: number; backfilled: number }> {
  const db = await getDb();
  let backfilled = 0;
  for (const l of labels) {
    const dayDate = l.dayDate && days.some((d) => d.date === l.dayDate) ? l.dayDate : null;
    await db
      .insert(photoLabels)
      .values({ tripId, fingerprint: l.fingerprint, category: l.category, dayDate })
      .onConflictDoUpdate({ target: [photoLabels.tripId, photoLabels.fingerprint], set: { category: l.category, dayDate, createdAt: new Date() } });
    const rows = await db.select().from(tripPhotos).where(and(eq(tripPhotos.tripId, tripId), eq(tripPhotos.fingerprint, l.fingerprint)));
    for (const r of rows) {
      const set: Partial<typeof tripPhotos.$inferInsert> = {};
      if (!r.category) set.category = l.category;
      if (dayDate && !r.manual && r.dayDate !== dayDate && !isScreenshotName(r.fileName)) Object.assign(set, { dayDate, itemId: null });
      if (!Object.keys(set).length) continue;
      await db.update(tripPhotos).set(set).where(eq(tripPhotos.id, r.id));
      backfilled++;
    }
  }
  return { saved: labels.length, backfilled };
}

/** Categories from a classified contact sheet, many photos at once. Unknown ids are skipped. */
export async function setCategories(tripId: string, items: { id: string; category: string }[]): Promise<number> {
  const db = await getDb();
  let n = 0;
  for (const it of items) {
    const r = await db.update(tripPhotos).set({ category: it.category }).where(and(eq(tripPhotos.tripId, tripId), eq(tripPhotos.id, it.id))).returning({ id: tripPhotos.id });
    n += r.length;
  }
  return n;
}

async function ownRow(tripId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "找不到");
  const db = await getDb();
  const r = await db.select().from(tripPhotos).where(and(eq(tripPhotos.id, id), eq(tripPhotos.tripId, tripId))).limit(1);
  if (!r[0]) throw new HttpError(404, "找不到");
  return r[0];
}

export async function updatePhoto(owner: Owner, tripId: string, id: string, body: z.infer<typeof patchBody>) {
  const row = await ownRow(tripId, id);
  const set: Partial<typeof tripPhotos.$inferInsert> = {};
  if (body.dayDate !== undefined || body.itemId !== undefined) {
    const trip = await getCurrentTrip(owner);
    const dayDate = body.dayDate !== undefined ? body.dayDate : row.dayDate;
    const day = dayDate ? trip?.doc.days.find((d) => d.date === dayDate) : null;
    if (dayDate && !day) throw new HttpError(400, "不是旅程裡的日子");
    // Moving to another day without naming an activity clears the old one.
    const itemId = body.itemId !== undefined ? body.itemId : body.dayDate !== undefined && body.dayDate !== row.dayDate ? null : row.itemId;
    if (itemId && !day?.items.some((i) => i.id === itemId)) throw new HttpError(400, "這天沒有這個活動");
    Object.assign(set, { dayDate, itemId, manual: true });
  }
  if (body.caption !== undefined) set.caption = body.caption.trim() || null;
  if (body.category !== undefined) set.category = body.category;
  if (!Object.keys(set).length) return view(row, true);
  const db = await getDb();
  const r = await db.update(tripPhotos).set(set).where(eq(tripPhotos.id, row.id)).returning();
  return view(r[0], true);
}

export async function deletePhoto(tripId: string, id: string) {
  const row = await ownRow(tripId, id);
  await deleteBlobs([row.displayPath, row.thumbPath, ...(row.videoPath ? [row.videoPath] : [])]);
  const db = await getDb();
  await db.delete(tripPhotos).where(eq(tripPhotos.id, row.id));
}

/** Re-sorts photos that have a time and were never moved by hand, after the trip changed. */
export async function resortPhotos(owner: Owner, tripId: string): Promise<number> {
  const trip = await getCurrentTrip(owner);
  if (!trip) return 0;
  const db = await getDb();
  const rows = await db.select().from(tripPhotos).where(and(eq(tripPhotos.tripId, tripId), eq(tripPhotos.manual, false)));
  let changed = 0;
  for (const r of rows) {
    if (!r.takenLocal || isScreenshotName(r.fileName)) continue;
    const dayDate = dayFor(r.takenLocal, trip.doc.days);
    const day = dayDate ? trip.doc.days.find((d) => d.date === dayDate) : undefined;
    const pos = r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null;
    const itemId = day ? itemFor(r.takenLocal, day.items, pos) : null;
    if (dayDate === r.dayDate && itemId === r.itemId) continue;
    await db.update(tripPhotos).set({ dayDate, itemId }).where(eq(tripPhotos.id, r.id));
    changed++;
  }
  return changed;
}

export async function photoStream(access: PhotoAccess, id: string, size: "thumb" | "full") {
  const row = await ownRow(access.tripId, id);
  // Viewers only reach sorted photos, as in the list.
  if (access.kind !== "owner" && !row.dayDate) throw new HttpError(404, "找不到");
  if (!blobConfigured()) return null;
  return readJpeg(size === "thumb" ? row.thumbPath : row.displayPath);
}

/** Before a video goes up: the largest size the browser may put in the store, or an error when it will not fit. */
export async function videoRoom(tripId: string, pathname: string, payload: string | null): Promise<number> {
  if (!blobConfigured()) throw new HttpError(503, "照片儲存空間還沒設定");
  if (!VIDEO_PATH.test(pathname)) throw new HttpError(400, "影片路徑不對");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(payload ?? "null");
  } catch {}
  const p = videoTokenPayload.safeParse(parsed);
  if (!p.success) throw new HttpError(400, "影片資料格式錯誤");
  const used = await usedBytes(tripId);
  // room for the poster and thumbnail too
  if (!fitsStorage(used, p.data.bytes + MAX_DISPLAY + MAX_THUMB)) throw new HttpError(507, FULL);
  return Math.min(MAX_VIDEO_BYTES, storageCaps().refuse - used - MAX_DISPLAY - MAX_THUMB);
}

/** A 30-minute link to the video for the player (the store serves ranges, so seeking works). */
export async function videoLink(access: PhotoAccess, id: string): Promise<string | null> {
  const row = await ownRow(access.tripId, id);
  if (access.kind !== "owner" && !row.dayDate) throw new HttpError(404, "找不到");
  if (!row.videoPath || !blobConfigured()) return null;
  return signedReadUrl(row.videoPath, 1800);
}

/** The video file itself, streamed through the site (downloads, where a redirect to the store would hit CORS). */
export async function videoFile(access: PhotoAccess, id: string) {
  const row = await ownRow(access.tripId, id);
  if (access.kind !== "owner" && !row.dayDate) throw new HttpError(404, "找不到");
  if (!row.videoPath || !blobConfigured()) return null;
  return readBlob(row.videoPath);
}

/** The trip as this person may see it: the owner's own document, or the redacted public one for viewers. */
export async function tripForPhotos(access: PhotoAccess): Promise<TripDoc | null> {
  if (access.kind === "owner") return (await getCurrentTrip(access.owner))?.doc ?? null;
  const db = await getDb();
  const { trips, tripVersions } = schema;
  const r = await db.select({ doc: tripVersions.doc }).from(trips).innerJoin(tripVersions, eq(tripVersions.id, trips.currentVersionId)).where(eq(trips.id, access.tripId)).limit(1);
  return r[0] ? (toPublicDoc(r[0].doc as TripDoc) as unknown as TripDoc) : null;
}
