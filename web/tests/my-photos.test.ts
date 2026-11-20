import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asOwner, asStranger, ctx, identity, ORIGIN, req, seededDb, signedOut } from "./helpers";
import * as P from "@/server/photo-handlers";
import * as H from "@/server/handlers";
import { allowSignIn } from "@/server/auth";
import { dayFor, exifLocal, fileNameLocal, itemFor } from "@/domain/photo-day";
import { placePhoto } from "@/server/my-photos";
import { isScreenshotName, matchCategory, parseClassification, printRanges, toCsv, uniqueName, spiral, launchAt, sortDuration } from "@/domain/photo-sort";
import { crc32, ZipWriter } from "@/domain/zip";
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
    () => P.postCheck(req("POST", "/api/my-photos/check", { fingerprints: [] })),
    () => P.postCategories(req("POST", "/api/my-photos/categories", { items: [{ id, category: "美食" }] })),
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
    expect((await P.postCategories(req("POST", "/api/my-photos/categories", { items: [{ id: photo.id, category: "美食" }] }))).status).toBe(401);
    expect((await P.postCheck(req("POST", "/api/my-photos/check", { fingerprints: [] }))).status).toBe(401);

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

const print = (s: string) => `1000:${sha(s)}`;

describe("sorting stage helpers", () => {
  it("knows screenshots by name and keeps them in 未分類 with the 截圖 category", () => {
    for (const n of ["Screenshot_20261115-101500.png", "Screen Shot 2026-11-15 at 10.15.jpg", "螢幕截圖 2026-11-15.png", "スクリーンショット 2026-11-15.png", "ScreenRecording_11-15.MP4"]) expect(isScreenshotName(n)).toBe(true);
    for (const n of ["IMG_1234.HEIC", "dji_export_20261115_photo_0034.jpeg", "screen-door.jpg"]) expect(isScreenshotName(n)).toBe(false);
    const days = [{ date: "2026-11-15", items: [] }] as never;
    expect(placePhoto({ fileName: "Screenshot_20261115-101500.png" }, { days })).toMatchObject({ dayDate: null, itemId: null, category: "截圖", takenLocal: "2026-11-15T10:15" });
    expect(placePhoto({ fileName: "IMG_20261115_101500.jpg" }, { days })).toMatchObject({ dayDate: "2026-11-15", category: null });
  });

  it("reads every reply format a Claude chat gives back", () => {
    const want = new Map([
      [1, "美食"],
      [2, "風景"],
    ]);
    expect(parseClassification('{"1":"美食","2":"風景"}', 5)).toEqual(want);
    expect(parseClassification('Here you go:\n```json\n{"1": "美食", "2": "風景"}\n```', 5)).toEqual(want);
    expect(parseClassification('{"results":[{"id":1,"category":"美食"},{"id":"2","category":"風景"}]}', 5)).toEqual(want);
    expect(parseClassification('[{"id":1,"category":"美食"},{"id":2,"category":"風景"}]', 5)).toEqual(want);
    expect(parseClassification("#1：美食\n#2: 風景", 5)).toEqual(want);
    expect(parseClassification("1. 美食\n2、風景", 5)).toEqual(want);
    expect(parseClassification("1 - 美食\n2 - 風景", 5)).toEqual(want);
    // Fuzzy names, unknown names and out-of-range numbers.
    expect(parseClassification('{"1":"美食咖啡","2":"cats","9":"風景","0":"風景"}', 5)).toEqual(new Map([[1, "美食"], [2, "其他"]]));
    expect(parseClassification("no idea", 5).size).toBe(0);
    expect(matchCategory("「合照」")).toBe("合照");
    expect(matchCategory("景")).toBe("風景");
  });

  it("fingerprints read three 64 KB slices, or the whole small file once", () => {
    expect(printRanges(1000)).toEqual([[0, 1000]]);
    expect(printRanges(1_000_000)).toEqual([
      [0, 65_536],
      [467_232, 532_768],
      [934_464, 1_000_000],
    ]);
  });

  it("writes a valid STORE zip with UTF-8 names, and CSV that Excel reads", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const zip = new ZipWriter();
    const a = new TextEncoder().encode("hello");
    zip.add("11-15 第13天/洞穴.jpg", a, crc32(a), a.length, new Date(2026, 10, 15, 13, 20));
    zip.add("未分類/x.jpg", a, crc32(a), a.length);
    const parts = zip.finish();
    const bytes = new Uint8Array(parts.reduce((n, p) => n + (p as Uint8Array).length, 0));
    let o = 0;
    for (const p of parts) {
      bytes.set(p as Uint8Array, o);
      o += (p as Uint8Array).length;
    }
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(6, true)).toBe(0x0800);
    const end = bytes.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const cdAt = v.getUint32(end + 16, true);
    expect(v.getUint32(cdAt, true)).toBe(0x02014b50);
    expect(new TextDecoder().decode(bytes.slice(30, 30 + v.getUint16(26, true)))).toBe("11-15 第13天/洞穴.jpg");

    const csv = toCsv([["檔名", "說明"], ["a,b.jpg", '=HYPERLINK("x")']]);
    expect(csv.startsWith("\ufeff檔名,說明\r\n")).toBe(true);
    expect(csv).toContain('"a,b.jpg"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    const taken = new Set<string>();
    expect([uniqueName("a.jpg", taken), uniqueName("A.jpg", taken), uniqueName("a.jpg", taken)]).toEqual(["a.jpg", "A (2).jpg", "a (3).jpg"]);
  });

  it("lays out the pile and the launch times", () => {
    const pts = Array.from({ length: 200 }, (_, i) => spiral(i, 200, 100, 20));
    expect(Math.max(...pts.map((p) => Math.hypot(p.x, p.y)))).toBeLessThanOrEqual(100);
    expect(sortDuration(10)).toBe(4000);
    expect(sortDuration(10_000)).toBe(20000);
    expect(launchAt(0, 100, 5000)).toBe(0);
    expect(launchAt(100, 100, 5000)).toBe(5000);
    // Slow start, then faster: the first quarter of the photos takes over 40% of the time.
    expect(launchAt(25, 100, 5000)).toBeGreaterThan(2000);
  });
});

describe("duplicates and categories (owner)", () => {
  it("skips a photo whose fingerprint is already stored, and tells the sorting stage which are known", async () => {
    const r = await P.postMyPhoto(upload({ sha256: sha("p1"), fingerprint: print("p1"), fileName: "IMG_1.jpg" }));
    expect(r.status).toBe(201);
    const first = (await json(r)).photo as { id: string };
    // Same original file, re-encoded differently by the browser: other sha, same fingerprint.
    const again = await P.postMyPhoto(upload({ sha256: sha("p1-other"), fingerprint: print("p1"), fileName: "IMG_1 copy.jpg" }));
    expect(again.status).toBe(200);
    expect(((await json(again)).photo as { id: string }).id).toBe(first.id);
    expect(store.size).toBe(2);
    expect((await P.postMyPhoto(upload({ sha256: sha("p2"), fingerprint: "bad", fileName: "x.jpg" }))).status).toBe(400);

    const known = await json(await P.postCheck(req("POST", "/api/my-photos/check", { fingerprints: [print("p1"), print("p9")] })));
    expect(known.known).toEqual([print("p1")]);
    expect((await P.postCheck(req("POST", "/api/my-photos/check", { fingerprints: ["nope"] }))).status).toBe(400);
  });

  it("sets categories in bulk and by hand, and shows them in the list", async () => {
    const ids: string[] = [];
    for (const k of ["c1", "c2"]) ids.push(((await json(await P.postMyPhoto(upload({ sha256: sha(k), fileName: `${k}.jpg` })))).photo as { id: string }).id);
    const shot = (await json(await P.postMyPhoto(upload({ sha256: sha("c3"), fileName: "Screenshot_20261115-101500.jpg" })))).photo as { id: string; category: string; dayDate: string | null };
    expect(shot).toMatchObject({ category: "截圖", dayDate: null });

    const r = await P.postCategories(req("POST", "/api/my-photos/categories", { items: [{ id: ids[0], category: "美食" }, { id: ids[1], category: "動物" }, { id: "00000000-0000-4000-8000-000000000000", category: "風景" }] }));
    expect(await json(r)).toEqual({ updated: 2 });
    expect((await P.postCategories(req("POST", "/api/my-photos/categories", { items: [{ id: ids[0], category: "咖啡" }] }))).status).toBe(400);
    expect((await P.patchMyPhoto(req("PATCH", `/api/my-photos/${ids[1]}`, { category: "風景" }), idCtx(ids[1]))).status).toBe(200);
    expect((await P.patchMyPhoto(req("PATCH", `/api/my-photos/${ids[1]}`, { category: "咖啡" }), idCtx(ids[1]))).status).toBe(400);
    const list = (await json(await P.getMyPhotos(req("GET", "/api/my-photos")))).photos as { id: string; category: string | null }[];
    expect(Object.fromEntries(list.map((p) => [p.id, p.category]))).toEqual({ [ids[0]]: "美食", [ids[1]]: "風景", [shot.id]: "截圖" });
  });
});

describe("viewer swipe physics", () => {
  it("projects the release velocity and moves one photo at most, never past the ends", async () => {
    const { project, swipeStep, rubber } = await import("@/components/motion");
    expect(project(1000)).toBeCloseTo(499, 0);
    // A short drag with a quick flick still turns the page; a slow half-drag does not.
    expect(swipeStep(-40, -800, 375, 2, 5)).toBe(1);
    expect(swipeStep(-100, 0, 375, 2, 5)).toBe(0);
    expect(swipeStep(60, 900, 375, 2, 5)).toBe(-1);
    // A huge flick is still one page.
    expect(swipeStep(-50, -20000, 375, 2, 5)).toBe(1);
    // Ends: nothing beyond the first or last photo.
    expect(swipeStep(80, 2000, 375, 0, 5)).toBe(0);
    expect(swipeStep(-80, -2000, 375, 4, 5)).toBe(0);
    // Rubber-band: past the edge the photo follows less and less.
    expect(rubber(100, 375)).toBeLessThan(100);
    expect(rubber(400, 375) - rubber(300, 375)).toBeLessThan(rubber(100, 375));
  });
});

describe("labels from Claude on Kai's Mac", () => {
  it("the local script and the browser give the same fingerprint for the same file", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { fileFingerprint } = await import("../scripts/classify-local");
    const { fingerprint } = await import("@/client/photo-upload");
    const dir = mkdtempSync(path.join(os.tmpdir(), "aya-print-"));
    for (const size of [1000, 300_000]) {
      const bytes = new Uint8Array(size).map((_, i) => (i * 31 + size) % 251);
      const f = path.join(dir, `p${size}.jpg`);
      writeFileSync(f, bytes);
      const node = await fileFingerprint(f);
      expect(node).toMatch(/^\d+:[0-9a-f]{64}$/);
      expect(await fingerprint(new Blob([bytes]))).toBe(node);
    }
  });

  it("applies a label on upload, back-fills stored photos, and tells the sorting stage", async () => {
    const { saveLabels } = await import("@/server/my-photos");
    const { getCurrentTrip } = await import("@/server/trips");
    const trip = (await getCurrentTrip({ githubId: "32431832" } as never))!;
    const other = trip.doc.days[3].date;
    // Already uploaded, no category yet.
    const before = (await json(await P.postMyPhoto(upload({ sha256: sha("L1"), fingerprint: print("L1"), fileName: "IMG_3500.jpg" })))).photo as { id: string };
    const res = await saveLabels(trip.tripId, trip.doc.days, [
      { fingerprint: print("L1"), category: "美食", dayDate: other },
      { fingerprint: print("L2"), category: "動物", dayDate: null },
    ]);
    expect(res).toEqual({ saved: 2, backfilled: 1 });
    let list = (await json(await P.getMyPhotos(req("GET", "/api/my-photos")))).photos as { id: string; category: string | null; dayDate: string | null }[];
    expect(list.find((p) => p.id === before.id)).toMatchObject({ category: "美食", dayDate: other });
    // Uploaded after labelling: the label fills the category.
    const after = (await json(await P.postMyPhoto(upload({ sha256: sha("L2"), fingerprint: print("L2"), fileName: "IMG_3501.jpg" })))).photo as { id: string; category: string };
    expect(after.category).toBe("動物");
    // The upload's own category wins over a label.
    await saveLabels(trip.tripId, trip.doc.days, [{ fingerprint: print("L3"), category: "交通", dayDate: null }]);
    const own = (await json(await P.postMyPhoto(upload({ sha256: sha("L3"), fingerprint: print("L3"), category: "風景", fileName: "IMG_3502.jpg" })))).photo as { category: string };
    expect(own.category).toBe("風景");
    const check = await json(await P.postCheck(req("POST", "/api/my-photos/check", { fingerprints: [print("L2"), print("L9")] })));
    expect(check.labels).toEqual({ [print("L2")]: "動物" });
    // A day moved by hand is not overwritten.
    await P.patchMyPhoto(req("PATCH", `/api/my-photos/${before.id}`, { dayDate: trip.doc.days[5].date }), idCtx(before.id));
    await saveLabels(trip.tripId, trip.doc.days, [{ fingerprint: print("L1"), category: "美食", dayDate: other }]);
    list = (await json(await P.getMyPhotos(req("GET", "/api/my-photos")))).photos as typeof list;
    expect(list.find((p) => p.id === before.id)?.dayDate).toBe(trip.doc.days[5].date);
    // Guests learn nothing about labels.
    signedOut();
    expect((await P.postCheck(req("POST", "/api/my-photos/check", { fingerprints: [print("L2")] }))).status).toBe(401);
  });
});
