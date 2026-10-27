import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { req, seedDoc, seededDb, signedOut } from "./helpers";
import * as H from "@/server/handlers";
import { putLookup } from "@/server/cache";
import { toPublicDoc } from "@/domain/privacy";
import { HOBART_CENTRE, guestPhotoUrl, quizStart } from "@/domain/quiz-start";
import type { TripDoc } from "@/domain/schema";

/* 旅遊規劃小測驗 for guests (Kai 2026-10-27): no home base on the public site, Commons photos only, no outside calls. */

const home = (doc: TripDoc) => Object.values(doc.stays).find((s) => s.home)!;

describe("guest quiz: where the day starts", () => {
  it("the public site starts from Hobart city centre, never the home base", () => {
    const doc = seedDoc();
    const pub = toPublicDoc(doc) as unknown as TripDoc;
    const s = quizStart(pub, "public");
    expect(s.pin).toEqual(HOBART_CENTRE);
    expect(s.name).toBe("荷巴特市中心");
    const h = home(doc);
    expect(JSON.stringify(s)).not.toContain(h.name);
    if (h.lat != null) expect([s.pin!.lat, s.pin!.lng]).not.toEqual([h.lat, h.lng]);
  });

  it("a share link keeps the rounded home position and only the word 住處", () => {
    const doc = seedDoc();
    const h = home(doc);
    const s = quizStart(toPublicDoc(doc, { photos: true }) as unknown as TripDoc, "share");
    expect(s.name).toBe("住處");
    if (h.lat != null && s.pin) {
      // ~300 m grid (0.003°), never the stored position.
      expect(Math.abs(s.pin.lat / 0.003 - Math.round(s.pin.lat / 0.003))).toBeLessThan(1e-6);
      expect([s.pin.lat, s.pin.lng]).not.toEqual([h.lat, h.lng]);
    }
  });

  it("guests see Wikimedia Commons photos only", () => {
    expect(guestPhotoUrl({ photo: { kind: "og", url: "https://trip.example/x.jpg" } as never })).toBeNull();
    expect(guestPhotoUrl({ photo: { kind: "custom", url: "/api/media/x.webp" } as never })).toBeNull();
    expect(guestPhotoUrl({ gallery: [{ kind: "custom", url: "/a" }, { kind: "commons", url: "https://upload.wikimedia.org/a.jpg" }] as never })).toBe("https://upload.wikimedia.org/a.jpg");
  });
});

describe("guest quiz: no outside calls (no Google, no Wikimedia search)", () => {
  let calls: string[];
  beforeEach(async () => {
    await seededDb();
    signedOut();
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (u: unknown) => {
      calls.push(String(u));
      throw new Error("no network in guest quiz");
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("public visitors read cached Commons photos and cached routes only", async () => {
    const pub = (await (await H.getPublicHome()).json()) as { doc: TripDoc };
    const it0 = pub.doc.attractionPool.flatMap((p) => p.items).find((i) => i.lat != null && i.lng != null)!;
    const photos = [{ kind: "commons", url: "https://upload.wikimedia.org/x.jpg", credit: "CC BY-SA" }];
    await putLookup("commons-photos", it0.id, { name: it0.name, lat: it0.lat, lng: it0.lng, photos }, "test", null);

    const r = await H.getPhotos(req("GET", `/api/photos?item=${it0.id}`));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { commons: unknown[] }).commons).toEqual(photos);

    const legs = await H.postRoutes(req("POST", "/api/routes", { points: [[-42.8826, 147.3286], [it0.lat, it0.lng]], compute: true }));
    expect(legs.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("the guest quiz routes a missing leg with the free OpenStreetMap router only, never Google", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key-not-real";
    const r = await H.postRoutes(req("POST", "/api/routes", { points: [[-42.8826, 147.3286], [-43.0, 147.0]], compute: true, quiz: true }));
    expect(r.status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((u) => u.startsWith("https://router.project-osrm.org/"))).toBe(true);
    delete process.env.GOOGLE_MAPS_API_KEY;
  });
});
