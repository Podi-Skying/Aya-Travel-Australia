import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asOwner, asStranger, ctx, identity, ORIGIN, req, seededDb, signedOut } from "./helpers";
import * as P from "@/server/photo-handlers";
import * as H from "@/server/handlers";
import { allowSignIn } from "@/server/auth";
import { dayFor, exifLocal, fileNameLocal, itemFor } from "@/domain/photo-day";
import { placePhoto } from "@/server/my-photos";
import type { Item } from "@/domain/schema";

/* Kai's own photos (docs/PHOTOS-PLAN.md): day sorting, access, and that guests learn nothing. */

const store = new Map<string, Uint8Array>();
vi.mock("@/server/photo-blob", () => ({
  blobConfigured: () => process.env.BLOB_READ_WRITE_TOKEN === "test",
  putJpeg: async (path: string, bytes: Uint8Array) => {
    const p = `${path}-x1`;
    store.set(p, bytes);
    return p;
  },
  readJpeg: async (path: string) => {
    const b = store.get(path);
    return b ? new Response(b as BlobPart).body : null;
  },
  deleteBlobs: async (paths: string[]) => {
    for (const p of paths) store.delete(p);
  },
}));

const jpeg = (n: number, seed = 1) => {
  const b = new Uint8Array(n).fill(seed);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function upload(meta: Record<string, unknown>, display = jpeg(2000), thumb = jpeg(300), headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append("display", new Blob([display as BlobPart], { type: "image/jpeg" }), "display.jpg");
  form.append("thumb", new Blob([thumb as BlobPart], { type: "image/jpeg" }), "thumb.jpg");
  form.append("meta", JSON.stringify({ width: 2048, height: 1536, ...meta }));
  return new Request(`${ORIGIN}/api/my-photos`, { method: "POST", headers: { host: "localhost:3000", origin: ORIGIN, ...headers }, body: form });
}

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const fileCtx = (id: string, size: string) => ({ params: Promise.resolve({ id, size }) });

beforeEach(async () => {
  await seededDb();
  asOwner();
  identity.email = null;
  store.clear();
  process.env.BLOB_READ_WRITE_TOKEN = "test";
  delete process.env.PHOTO_VIEWERS;
});
afterEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.PHOTO_VIEWERS;
});

describe("day and activity from a photo's time", () => {
  it("reads EXIF wall time, and moves an instant with an offset into the trip zone", () => {
    expect(exifLocal("2026:11:15 13:05:22")).toEqual({ local: "2026-11-15T13:05", at: null });
    // 02:30 UTC is 13:30 in Hobart (UTC+11 in November).
    expect(exifLocal("2026:11:15 02:30:00", "+00:00")?.local).toBe("2026-11-15T13:30");
    expect(exifLocal("2026:11:14 23:30:00", "+08:00")?.local).toBe("2026-11-15T02:30");
    expect(exifLocal("2026:13:40 10:00:00")).toBeNull();
    expect(exifLocal(null)).toBeNull();
  });

  it("finds dates in file names", () => {
    expect(fileNameLocal("dji_export_20261115_photo_0034.jpeg")).toEqual({ local: "2026-11-15", hasTime: false });
    expect(fileNameLocal("IMG_20261109_143012.jpg")).toEqual({ local: "2026-11-09T14:30", hasTime: true });
    expect(fileNameLocal("20261110_090500.HEIC")?.local).toBe("2026-11-10T09:05");
    expect(fileNameLocal("IMG_3490.jpeg")).toBeNull();
    expect(fileNameLocal("photo_20261340.jpg")).toBeNull();
  });

  it("keeps dates outside the trip unsorted", () => {
    const days = [{ date: "2026-11-15" }];
    expect(dayFor("2026-11-15T09:00", days)).toBe("2026-11-15");
    expect(dayFor("2026-11-15", days)).toBe("2026-11-15");
    expect(dayFor("2026-12-01T09:00", days)).toBeNull();
    expect(dayFor(null, days)).toBeNull();
  });

  it("picks the activity whose window holds the time, preferring places to getting somewhere, then GPS", () => {
    const items = [
      { id: "bus", name: "搭公車到朋友家", time: "08:57", dur: 30 },
      { id: "cave", name: "Newdegate 鐘乳石洞導覽", time: "13:00", dur: 45, lat: -43.38, lng: 146.85 },
      { id: "pool", name: "溫泉池", time: "13:30", dur: 90, lat: -43.39, lng: 146.86 },
      { id: "lunch", name: "午餐", time: "12:00", dur: 30 },
    ] as unknown as Item[];
    expect(itemFor("2026-11-15T09:10", items)).toBe("bus");
    expect(itemFor("2026-11-15T13:10", items)).toBe("cave");
    // Overlap without GPS: the later start.
    expect(itemFor("2026-11-15T13:40", items)).toBe("pool");
    // Overlap with GPS: the nearer place.
    expect(itemFor("2026-11-15T13:40", items, { lat: -43.3801, lng: 146.8501 })).toBe("cave");
    expect(itemFor("2026-11-15T12:44", items)).toBe("lunch");
    expect(itemFor("2026-11-15T18:00", items)).toBeNull();
    expect(itemFor("2026-11-15", items)).toBeNull();
  });

  it("is decided by the server from the raw time and the trip", () => {
    const days = [{ date: "2026-11-15", items: [{ id: "cave", name: "洞穴", time: "13:00", dur: 45 }] }] as never;
    expect(placePhoto({ fileName: "dji_export_20261115_photo_0034.jpeg" }, { days })).toMatchObject({ dayDate: "2026-11-15", itemId: null, timeSource: "filename" });
    expect(placePhoto({ fileName: "x.jpg", exifTime: "2026:11:15 13:20:00" }, { days })).toMatchObject({ dayDate: "2026-11-15", itemId: "cave", timeSource: "exif" });
    expect(placePhoto({ fileName: "x.jpg" }, { days })).toMatchObject({ dayDate: null, timeSource: "none" });
  });
});

async function seedDayWithItem() {
  const t = (await json(await H.getTrip(req("GET", "/api/trip")))) as { doc: { days: { date: string; items: { id: string; time?: string; name: string }[] }[] } };
  const day = t.doc.days.find((d) => d.items.some((i) => i.time && !/搭|入住|退房|check/i.test(i.name)))!;
  const item = day.items.find((i) => i.time && !/搭|入住|退房|check/i.test(i.name))!;
  return { day, item };
}

describe("upload, edit, delete (owner)", () => {
  it("stores a photo on its day, de-duplicates, and refuses bad input", async () => {
    const { day, item } = await seedDayWithItem();
    const [hh, mm] = item.time!.split(":");
    const exif = `${day.date.replaceAll("-", ":")} ${hh}:${mm}:30`;
    const r = await P.postMyPhoto(upload({ sha256: sha("a"), fileName: "IMG_1.jpg", exifTime: exif, dayDate: "1999-01-01", itemId: "nope" }));
    expect(r.status).toBe(201);
    const p = (await json(r)).photo as { id: string; dayDate: string; itemId: string };
    // The client cannot choose the day or activity: the server ignores those fields.
    expect(p.dayDate).toBe(day.date);
    expect(p.itemId).toBe(item.id);
    expect(store.size).toBe(2);

    const again = await P.postMyPhoto(upload({ sha256: sha("a"), fileName: "IMG_1.jpg", exifTime: exif }));
    expect(again.status).toBe(200);
    expect(((await json(again)).photo as { id: string }).id).toBe(p.id);
    expect(store.size).toBe(2);

    expect((await P.postMyPhoto(upload({ sha256: sha("b"), fileName: "x.png" }, new Uint8Array(500).fill(7)))).status).toBe(415);
    expect((await P.postMyPhoto(upload({ sha256: sha("c"), fileName: "x.jpg" }, jpeg(3_100_000)))).status).toBe(413);
    expect((await P.postMyPhoto(upload({ sha256: "zz", fileName: "x.jpg" }))).status).toBe(400);
    expect((await P.postMyPhoto(upload({ sha256: sha("d"), fileName: "x.jpg" }, jpeg(10), jpeg(10), { origin: "https://evil.example" }))).status).toBe(403);
  });

  it("puts photos without a usable date in 未分類, moves them, captions and deletes them", async () => {
    const { day, item } = await seedDayWithItem();
    const r = await P.postMyPhoto(upload({ sha256: sha("e"), fileName: "IMG_3490.jpeg" }));
    const id = ((await json(r)).photo as { id: string; dayDate: string | null }).id;
    let list = (await json(await P.getMyPhotos(req("GET", "/api/my-photos")))).photos as { id: string; dayDate: string | null }[];
    expect(list.find((x) => x.id === id)?.dayDate).toBeNull();

    expect((await P.patchMyPhoto(req("PATCH", `/api/my-photos/${id}`, { dayDate: "2030-01-01" }), idCtx(id))).status).toBe(400);
    expect((await P.patchMyPhoto(req("PATCH", `/api/my-photos/${id}`, { dayDate: day.date, itemId: "missing" }), idCtx(id))).status).toBe(400);
    const ok = await P.patchMyPhoto(req("PATCH", `/api/my-photos/${id}`, { dayDate: day.date, itemId: item.id, caption: " 洞口 " }), idCtx(id));
    expect(ok.status).toBe(200);
    expect((await json(ok)).photo).toMatchObject({ dayDate: day.date, itemId: item.id, caption: "洞口", manual: true });

    const file = await P.getMyPhotoFile(req("GET", `/api/my-photos/${id}/thumb`), fileCtx(id, "thumb"));
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toContain("private");

    expect((await P.deleteMyPhoto(req("DELETE", `/api/my-photos/${id}`), idCtx(id))).status).toBe(200);
    expect(store.size).toBe(0);
    list = (await json(await P.getMyPhotos(req("GET", "/api/my-photos")))).photos as typeof list;
    expect(list).toHaveLength(0);
  });

  it("says the store is not set up instead of failing", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const r = await P.getMyPhotos(req("GET", "/api/my-photos"));
    expect(r.status).toBe(200);
    expect((await json(r)).configured).toBe(false);
    expect((await P.postMyPhoto(upload({ sha256: sha("f"), fileName: "a.jpg" }))).status).toBe(503);
  });
});

describe("who can see them", () => {
  async function onePhoto() {
    asOwner();
    const { day } = await seedDayWithItem();
    const r = await P.postMyPhoto(upload({ sha256: sha("g"), fileName: `dji_export_${day.date.replaceAll("-", "")}_photo_0001.jpeg` }));
    const photo = (await json(r)).photo as { id: string; dayDate: string };
    await P.patchMyPhoto(req("PATCH", `/api/my-photos/${photo.id}`, { caption: "SECRET-CAPTION" }), idCtx(photo.id));
    return photo;
  }

  const routes = (id: string) => [
    () => P.getMyPhotos(req("GET", "/api/my-photos")),
    () => P.getMyPhotoFile(req("GET", `/api/my-photos/${id}/full`), fileCtx(id, "full")),
    () => P.getMyPhotoFile(req("GET", `/api/my-photos/${id}/thumb`), fileCtx(id, "thumb")),
    () => P.patchMyPhoto(req("PATCH", `/api/my-photos/${id}`, { caption: "x" }), idCtx(id)),
    () => P.deleteMyPhoto(req("DELETE", `/api/my-photos/${id}`), idCtx(id)),
    () => P.getViewers(req("GET", "/api/my-photos/viewers")),
    () => P.postLink(req("POST", "/api/my-photos/links", {})),
  ];

  it("guests and strangers get the same 401, whether or not photos exist", async () => {
    signedOut();
    const empty = await (await P.getMyPhotos(req("GET", "/api/my-photos"))).text();
    const photo = await onePhoto();
    for (const who of [signedOut, asStranger]) {
      who();
      for (const call of routes(photo.id)) {
        const r = await call();
        expect(r.status).toBe(401);
        expect(await r.text()).toBe(empty);
      }
    }
    expect(store.size).toBe(2);
  });

  it("nothing about the photos reaches the public trip or a share link", async () => {
    const photo = await onePhoto();
    const share = (await json(await H.postShare(req("POST", "/api/share")))) as { url?: string; token?: string };
    const token = share.token ?? String(share.url).split("/s/")[1];
    signedOut();
    const pub = await (await H.getPublicHome()).text();
    const viaShare = await (await H.getPublic(req("GET", `/api/s/${token}`), ctx(token))).text();
    for (const text of [pub, viaShare]) {
      expect(text).not.toContain(photo.id);
      expect(text).not.toContain("SECRET-CAPTION");
      expect(text).not.toContain("trip-photos/");
      expect(text).not.toContain("my-photos");
    }
    // A share token in the query or a cookie does not open private photos either.
    const r = await P.getMyPhotoFile(new Request(`${ORIGIN}/api/my-photos/${photo.id}/full?token=${token}`, { headers: { cookie: `aya_photos=${token}` } }), fileCtx(photo.id, "full"));
    expect(r.status).toBe(401);
  });

  it("allowlisted accounts and viewer links work only with PHOTO_VIEWERS=1, and never see GPS or 未分類", async () => {
    const photo = await onePhoto();
    await P.postMyPhoto(upload({ sha256: sha("h"), fileName: "no-date.jpg" }));
    expect((await P.postViewer(req("POST", "/api/my-photos/viewers", { kind: "email", value: "Aya@Example.com", label: "Aya" }))).status).toBe(201);
    expect((await P.postViewer(req("POST", "/api/my-photos/viewers", { kind: "github", value: "555" }))).status).toBe(201);
    const link = (await json(await P.postLink(req("POST", "/api/my-photos/links", { label: "Aya" })))) as { id: string; url: string };
    const token = link.url.split("/p/")[1];

    // Flag off: nobody but the owner.
    asStranger();
    identity.email = "aya@example.com";
    expect((await P.getMyPhotos(req("GET", "/api/my-photos"))).status).toBe(401);
    signedOut();
    identity.email = null;
    const withCookie = (path: string) => new Request(`${ORIGIN}${path}`, { headers: { cookie: `aya_photos=${encodeURIComponent(token)}` } });
    expect((await P.getMyPhotos(withCookie("/api/my-photos"))).status).toBe(401);
    expect(await allowSignIn("github", { id: 555 })).toBe(false);

    process.env.PHOTO_VIEWERS = "1";
    expect(await allowSignIn("github", { id: 555 })).toBe(true);
    expect(await allowSignIn("google", { email: "AYA@example.com", email_verified: true })).toBe(true);
    expect(await allowSignIn("google", { email: "aya@example.com", email_verified: false })).toBe(false);
    expect(await allowSignIn("github", { id: 777, email: "someone@else.com" })).toBe(false);
    expect(await allowSignIn("github", { id: 32431832 })).toBe(true);

    asStranger();
    identity.email = "aya@example.com";
    const viewer = await json(await P.getMyPhotos(req("GET", "/api/my-photos")));
    const vp = viewer.photos as Record<string, unknown>[];
    expect(vp.map((x) => x.id)).toEqual([photo.id]);
    expect(vp[0]).not.toHaveProperty("lat");
    expect(vp[0]).not.toHaveProperty("fileName");
    expect(viewer).not.toHaveProperty("usedBytes");
    expect((await P.patchMyPhoto(req("PATCH", `/api/my-photos/${photo.id}`, { caption: "x" }), idCtx(photo.id))).status).toBe(401);

    signedOut();
    identity.email = null;
    const open = await P.openViewerLink(new Request(`${ORIGIN}/p/${token}`), { params: Promise.resolve({ token }) });
    expect(open.status).toBe(303);
    expect(open.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await P.getMyPhotos(withCookie("/api/my-photos"))).status).toBe(200);
    expect((await P.getMyPhotoFile(withCookie(`/api/my-photos/${photo.id}/full`), fileCtx(photo.id, "full"))).status).toBe(200);

    asOwner();
    expect((await P.deleteLink(req("DELETE", `/api/my-photos/links/${link.id}`), idCtx(link.id))).status).toBe(200);
    signedOut();
    expect((await P.getMyPhotos(withCookie("/api/my-photos"))).status).toBe(401);
    const bad = await P.openViewerLink(new Request(`${ORIGIN}/p/${token}`), { params: Promise.resolve({ token }) });
    expect(bad.headers.get("location")).toContain("link=invalid");
    expect(bad.headers.get("set-cookie")).toBeNull();
  });
});
