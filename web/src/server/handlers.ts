import { randomUUID } from "node:crypto";
import { errorResponse, fail, HttpError, json, ownerRoute, readJson, sameOrigin } from "./http";
import { checkOwner } from "./owner";
import { getLegs, MAX_POINTS, validPoints } from "./routes";
import { getKpOutlook } from "./sky";
import { googleKey, placePhoto, placePhotos, sameRef, type PlaceRef } from "./google";
import { commonsPhotos } from "./commons";
import { dailyCap, hobartDay, monthCost, noteGoogleHit, usageSince } from "./usage";
import { getLookup } from "./cache";
import { missingConfig } from "./config";
import { getPublicHomeTrip, publicHomeEnabled } from "./public-home";
import { applyOwnerOp, deleteTrip, getCurrentTrip, importDoc, listVersions, restoreVersion } from "./trips";
import { routeQuota, sha256, createShareLink, deactivateShareLinks, getPublicTrip, interestCounts, myVotes, shareStatus, submitVote, withdrawVote } from "./sharing";
import { alertStatus } from "@/domain/rules";
import { todayStr } from "@/domain/format";
import type { Op } from "@/domain/ops";

/* Route handler bodies, kept outside app/ so integration tests can call them directly. */

const MAX_DOC_BYTES = 1_000_000;
const OFFLINE_VERSION_DOCS = 20;

function num(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(400, `缺少或錯誤的 ${name}`);
  return v;
}

export const getTrip = ownerRoute(async (_req, owner) => {
  const cur = await getCurrentTrip(owner);
  if (!cur) return fail(404, "找不到行程");
  return json({ ...cur, alerts: alertStatus(cur.doc, { showWindow: true }), syncedAt: new Date().toISOString() });
});

const OPS = new Set<Op["op"]>([
  "setPriority", "toggleVerify", "confirmDriver", "clearDriver", "setPartySize", "setParticipants",
  "editItem", "addItem", "removeItem", "schedulePackage", "scheduleItem", "unscheduleItem", "moveItem", "setStatus", "clearDay", "setPeople",
  "addSkyLink", "removeSkyLink", "addSkyPost", "removeSkyPost", "applyOption", "snapshot",
]);

export const postOp = ownerRoute(async (req, owner) => {
  const b = (await readJson(req, 20_000)) as { baseVersionNo?: unknown; op?: Record<string, unknown> };
  const base = num(b.baseVersionNo, "baseVersionNo");
  const op = b.op;
  if (!op || typeof op.op !== "string" || !OPS.has(op.op as Op["op"])) return fail(400, "未知的操作");
  // Server-assigned values: the date for "verified" and ids for new items.
  const full = { ...op, ...(op.op === "toggleVerify" ? { today: todayStr() } : {}), ...(op.op === "addItem" || op.op === "addSkyLink" || op.op === "addSkyPost" ? { newId: "u" + randomUUID().slice(0, 12) } : {}) } as Op;
  const r = await applyOwnerOp(owner, base, full);
  return json(r);
});

export const postRestore = ownerRoute(async (req, owner) => {
  const b = (await readJson(req, 2_000)) as Record<string, unknown>;
  return json(await restoreVersion(owner, num(b.baseVersionNo, "baseVersionNo"), num(b.versionNo, "versionNo")));
});

export const postImport = ownerRoute(async (req, owner) => {
  const b = (await readJson(req, MAX_DOC_BYTES)) as Record<string, unknown>;
  return json(await importDoc(owner, num(b.baseVersionNo, "baseVersionNo"), b.doc));
});

export const getVersions = ownerRoute(async (req, owner) => {
  const withDocs = new URL(req.url).searchParams.get("docs") === "1";
  return json({ versions: await listVersions(owner, { withDocsRecent: withDocs ? OFFLINE_VERSION_DOCS : 0 }) });
});

export const getExport = ownerRoute(async (_req, owner) => {
  const cur = await getCurrentTrip(owner);
  if (!cur) return fail(404, "找不到行程");
  return json(cur.doc, 200, { "content-disposition": `attachment; filename="aya-trip-v${cur.versionNo}.json"` });
});

export const deleteTripHandler = ownerRoute(async (req, owner) => {
  const b = (await readJson(req, 2_000)) as Record<string, unknown>;
  await deleteTrip(owner, typeof b.confirmTitle === "string" ? b.confirmTitle : "");
  return json({ deleted: true });
});

export const getShare = ownerRoute(async (_req, owner) => json(await shareStatus(owner)));
export const postShare = ownerRoute(async (_req, owner) => json(await createShareLink(owner)));
export const deleteShare = ownerRoute(async (_req, owner) => {
  await deactivateShareLinks(owner);
  return json({ active: false });
});

export const getInterest = ownerRoute(async (_req, owner) => {
  const cur = await getCurrentTrip(owner);
  if (!cur) return fail(404, "找不到行程");
  return json(await interestCounts(owner, cur.doc));
});

/* ---------- public ---------- */

type Ctx = { params: Promise<{ token: string }> };

function publicConfigError(): Response | null {
  const missing = missingConfig("public");
  return missing.length ? fail(503, "伺服器設定未完成", { missing }) : null;
}

export async function getPublic(_req: Request, ctx: Ctx) {
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const { token } = await ctx.params;
    const t = await getPublicTrip(token);
    if (!t) return fail(404, "分享連結無效或已停用");
    return json({ ...t, alerts: alertStatus(t.doc as never, { showWindow: false }), syncedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Public home data (PUBLIC_HOME=1 only): same redacted document as share links. */
export async function getPublicHome() {
  if (!publicHomeEnabled()) return fail(404, "公開瀏覽未開啟");
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const t = await getPublicHomeTrip();
    if (!t) return fail(404, "找不到行程");
    return json({ ...t, alerts: alertStatus(t.doc as never, { showWindow: false }), syncedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}

const VOTE_BYTES = 2_000;

export async function postVote(req: Request, ctx: Ctx) {
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const { token } = await ctx.params;
    return json(await submitVote(token, await readJson(req, VOTE_BYTES)));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function deleteVote(req: Request, ctx: Ctx) {
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const { token } = await ctx.params;
    return json(await withdrawVote(token, await readJson(req, VOTE_BYTES)));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function postMyVotes(req: Request, ctx: Ctx) {
  const cfg = publicConfigError();
  if (cfg) return cfg;
  try {
    const { token } = await ctx.params;
    return json({ votes: await myVotes(token, await readJson(req, VOTE_BYTES)) });
  } catch (e) {
    return errorResponse(e);
  }
}

/* ---------- caches (PLAN-2026-10-26 §1–2) ---------- */

/** Aurora outlook for everyone; the NOAA feed is fetched at most once per TTL. */
export async function getSky() {
  try {
    return json(await getKpOutlook(), 200, { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" });
  } catch (e) {
    return errorResponse(e);
  }
}

const ROUTE_BYTES = 4_000;

/** Road legs: the owner computes missing legs, everyone else reads the cache only. */
export async function postRoutes(req: Request) {
  try {
    // Same-origin JSON only, checked before any quota is charged (share-link viewers are same-origin).
    if (!sameOrigin(req)) return fail(403, "來源不符");
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return fail(415, "需要 JSON");
    const b = (await readJson(req, ROUTE_BYTES)) as { points?: unknown; refresh?: unknown; compute?: unknown };
    const points = validPoints(b.points);
    if (!points) return fail(400, `需要 2–${MAX_POINTS} 個座標`);
    const c = missingConfig("owner").length ? null : await checkOwner();
    const owner = !!c?.ok && sameOrigin(req);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    // Reads are limited per client; the owner's computation quota is charged only when OSRM will be called.
    if (!owner && !(await routeQuota(`routes-ip:${sha256(ip)}`, 120))) return fail(429, "操作太頻繁，請稍後再試");
    const hit = await getLegs(points, { compute: false });
    const refresh = owner && b.refresh === true;
    const missing = hit.legs.some((l) => !l);
    // A page view answered from route_cache: counted as a cache hit, no Google call.
    if (!missing && googleKey()) await noteGoogleHit("routes");
    // Page views only read route_cache; computing takes an explicit owner action (compute: true) or the backfill.
    if (!owner || b.compute !== true || (!missing && !refresh)) return json(hit);
    if (!(await routeQuota(`routes:${c!.ok ? c!.owner.githubId : ""}`, 30, false))) return json({ ...hit, limited: true });
    const r = await getLegs(points, { compute: true, refresh }).catch(() => null); // routing service unavailable: straight lines stay
    return json(r ?? { ...hit, unavailable: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/* ---------- Google (docs/PLAN-2026-10-26-google.md) ---------- */

/** Owner-only: key configured (boolean), the last 14 days per API, month-to-date estimate. Never the key. */
export const getGoogleStatus = ownerRoute(async () => {
  const now = new Date();
  try {
    const days = await usageSince(hobartDay(new Date(now.getTime() - 13 * 86_400_000)));
    const today = days.find((d) => d.date === hobartDay(now));
    return json({ keyPresent: !!googleKey(), dailyCap: dailyCap(), callsToday: today?.calls ?? 0, days, month: await monthCost(hobartDay(now).slice(0, 7)) });
  } catch {
    // Never report zero when the numbers are unknown.
    return json({ keyPresent: !!googleKey(), usageUnavailable: true }, 503);
  }
});

/**
 * Numbers-only daily usage for a scheduled report (no login): counts per API, cache hits and the
 * month-to-date cost estimate. No keys, places or people. Rate limited per client.
 */
export async function getUsageDaily(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    if (!(await routeQuota(`usage-ip:${sha256(ip)}`, 30))) return fail(429, "操作太頻繁，請稍後再試");
    const q = new URL(req.url).searchParams.get("date");
    const date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : hobartDay();
    let d, month;
    try {
      d = (await usageSince(date)).find((x) => x.date === date);
      month = await monthCost(date.slice(0, 7));
    } catch {
      return fail(503, "usage unavailable");
    }
    return json({ date, apis: d?.apis ?? {}, calls: d?.calls ?? 0, cacheHits: d?.hits ?? 0, dailyCap: dailyCap(), monthToDate: { estimatedUsd: month.usd, calls: month.calls } });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * A live Google photo for an activity whose place id was found by the backfill. Photo names may not
 * be cached (Places terms), so each answer is resolved now; browsers keep it 30 minutes. Owner only:
 * guests never trigger Google calls.
 */
export const getPlacePhoto = ownerRoute(async (req, owner) => {
  const item = new URL(req.url).searchParams.get("item") ?? "";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(item)) return fail(400, "缺少活動 id");
  const hit = await getLookup<PlaceRef>("place-id", item).catch(() => null);
  if (!hit?.value.placeId) return fail(404, "沒有 Google 地點");
  // The stored place must still describe this activity (it may have been renamed since the backfill).
  const cur = await getCurrentTrip(owner);
  const it = cur && [...cur.doc.days.flatMap((d) => d.items), ...cur.doc.attractionPool.flatMap((p) => p.items)].find((i) => i.id === item);
  if (!it || !sameRef(hit.value, it.name, it.lat, it.lng)) return fail(404, "地點需要重新比對");
  const p = await placePhoto(hit.value.placeId).catch(() => null);
  if (!p) return fail(404, "沒有照片");
  return json(p, 200, { "cache-control": "private, max-age=1800" });
});

/* ---------- gallery photos (docs/PLAN-2026-10-26-galleries.md) ---------- */

/** Finds an activity by id in a trip document (days and pool). */
const findIn = (doc: { days: { items: { id: string; name: string; lat?: number; lng?: number }[] }[]; attractionPool: { items: { id: string; name: string; lat?: number; lng?: number }[] }[] }, id: string) =>
  [...doc.days.flatMap((d) => d.items), ...doc.attractionPool.flatMap((p) => p.items)].find((i) => i.id === id);

/**
 * Cached Commons photos for an activity. Photos are for the owner and share-link viewers only (as in
 * the trip document), so a share token or the owner session is required. Never calls out.
 */
export async function getPhotos(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const item = q.get("item") ?? "";
    const token = q.get("token");
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(item)) return fail(400, "缺少活動 id");
    let doc: Parameters<typeof findIn>[0] | null = null;
    if (token) doc = (await getPublicTrip(token))?.doc ?? null;
    else {
      const c = missingConfig("owner").length ? null : await checkOwner();
      if (c?.ok) doc = (await getCurrentTrip(c.owner))?.doc ?? null;
    }
    if (!doc) return fail(401, "需要分享連結或登入");
    const it = findIn(doc, item);
    if (!it || it.lat == null || it.lng == null) return json({ commons: [] });
    const commons = (await commonsPhotos(item, it.name, it.lat, it.lng, { search: false }).catch(() => null)) ?? [];
    return json({ commons }, 200, { "cache-control": "private, max-age=600" });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Owner only: up to 6 live Google photos for an activity (photo names may not be cached). */
export const getPlacePhotos = ownerRoute(async (req, owner) => {
  const item = new URL(req.url).searchParams.get("item") ?? "";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(item)) return fail(400, "缺少活動 id");
  const hit = await getLookup<PlaceRef>("place-id", item).catch(() => null);
  if (!hit?.value.placeId) return json({ photos: [] });
  const cur = await getCurrentTrip(owner);
  const it = cur && findIn(cur.doc, item);
  if (!it || !sameRef(hit.value, it.name, it.lat, it.lng)) return json({ photos: [] });
  const photos = await placePhotos(hit.value.placeId, 6).catch(() => []);
  return json({ photos }, 200, { "cache-control": "private, max-age=1500" });
});

/**
 * Private photos (Kai's own, in web/media/), served only to the owner or with a valid share token,
 * like every photo in the trip document. Paths are restricted to web/media.
 */
export async function getMedia(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: parts } = await ctx.params;
    const rel = parts.join("/");
    if (!/^[a-z0-9/_-]+\.(webp|jpg|png)$/.test(rel) || rel.includes("..")) return fail(404, "找不到");
    const token = new URL(req.url).searchParams.get("token");
    let ok = false;
    if (token) ok = !!(await getPublicTrip(token));
    else {
      const c = missingConfig("owner").length ? null : await checkOwner();
      ok = !!c?.ok;
    }
    if (!ok) return fail(401, "需要分享連結或登入");
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const buf = await readFile(path.join(process.cwd(), "media", rel)).catch(() => null);
    if (!buf) return fail(404, "找不到");
    const type = rel.endsWith(".webp") ? "image/webp" : rel.endsWith(".png") ? "image/png" : "image/jpeg";
    return new Response(new Uint8Array(buf), { headers: { "content-type": type, "cache-control": "private, max-age=86400", "x-robots-tag": "noindex" } });
  } catch (e) {
    return errorResponse(e);
  }
}
