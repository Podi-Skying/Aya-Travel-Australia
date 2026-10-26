import { beforeEach, describe, expect, it } from "vitest";
import { asOwner, req, seededDb, seedDoc, signedOut } from "./helpers";
import * as H from "@/server/handlers";
import { parseCommons } from "@/server/commons";
import { putLookup } from "@/server/cache";
import { galleryPhotos } from "@/domain/gallery";
import { parseTripDoc, type TripDoc } from "@/domain/schema";
import { withMediaToken } from "@/domain/media";
import { toPublicDoc } from "@/domain/privacy";

/* docs/PLAN-2026-10-26-galleries.md */

const commonsBody = {
  query: {
    pages: {
      "2": { index: 2, imageinfo: [{ mime: "image/jpeg", width: 3000, thumburl: "https://upload.wikimedia.org/b.jpg", thumbwidth: 1280, thumbheight: 853, descriptionurl: "https://commons.wikimedia.org/wiki/File:B.jpg", extmetadata: { Artist: { value: "<a href='x'>Bob</a>" }, LicenseShortName: { value: "CC BY 2.0" } } }] },
      "1": { index: 1, imageinfo: [{ mime: "image/jpeg", width: 2000, thumburl: "https://upload.wikimedia.org/a.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg", extmetadata: {} }] },
      "3": { index: 3, imageinfo: [{ mime: "image/svg+xml", width: 4000, thumburl: "https://upload.wikimedia.org/c.png", descriptionurl: "https://commons.wikimedia.org/wiki/File:C.svg" }] },
      "4": { index: 4, imageinfo: [{ mime: "image/jpeg", width: 500, thumburl: "https://upload.wikimedia.org/d.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:D.jpg" }] },
    },
  },
};

describe("gallery photo sources", () => {
  it("parses Commons results in search order, keeping JPEG/PNG ≥ 800px with artist and licence", () => {
    const p = parseCommons(commonsBody);
    expect(p.map((x) => x.url)).toEqual(["https://upload.wikimedia.org/a.jpg", "https://upload.wikimedia.org/b.jpg"]);
    expect(p[1]).toMatchObject({ credit: "Bob", license: "CC BY 2.0", kind: "commons", site: "commons.wikimedia.org" });
  });

  it("assembles own, gallery, Commons then Google photos without duplicates", () => {
    const own = { url: "https://e.x/1.jpg", page: "https://e.x", site: "e.x", kind: "og" as const };
    const g = galleryPhotos(
      { name: "Place", photo: own, gallery: [{ url: "/api/media/b/1.webp", page: "/api/media/b/1.webp", site: "Kai 提供", kind: "custom" }] },
      [own, { url: "https://upload.wikimedia.org/a.jpg", page: "https://commons.wikimedia.org/a", site: "commons.wikimedia.org", kind: "commons" }],
      [{ photoUri: "https://lh3.googleusercontent.com/x", attributions: [{ name: "A" }], mapsUri: "https://maps.google.com/x" }],
    );
    expect(g.map((x) => x.src)).toEqual(["https://e.x/1.jpg", "/api/media/b/1.webp", "https://upload.wikimedia.org/a.jpg", "https://lh3.googleusercontent.com/x"]);
    expect(g[3].credit.authors).toEqual([{ name: "A" }]);
  });

  it("accepts private /api/media photos in galleries, hides galleries from public documents, and tokenises them on share pages", () => {
    const doc = seedDoc() as TripDoc;
    doc.days[0].items[0].gallery = [{ url: "/api/media/balloon-aloft/06-redballoon-sunrise.webp", page: "/api/media/balloon-aloft/06-redballoon-sunrise.webp", site: "Kai 提供", kind: "custom" }];
    const r = parseTripDoc(doc);
    expect(r.ok).toBe(true);
    expect(parseTripDoc({ ...doc, days: doc.days.map((d, i) => (i ? d : { ...d, items: [{ ...d.items[0], gallery: [{ url: "/etc/passwd", page: "/x", site: "x", kind: "custom" }] }] })) }).ok).toBe(false);
    expect(JSON.stringify(toPublicDoc(r.ok ? r.doc : doc))).not.toContain("balloon-aloft");
    const t = withMediaToken(doc, "tok");
    expect(t.days[0].items[0].gallery![0].url).toBe("/api/media/balloon-aloft/06-redballoon-sunrise.webp?token=tok");
  });
});

describe("gallery endpoints", () => {
  let token = "";
  beforeEach(async () => {
    await seededDb();
    asOwner();
    token = ((await (await H.postShare(req("POST", "/api/trip/share"))).json()) as { token: string }).token;
  });

  it("/api/photos needs the owner or a share token, and only reads the cache", async () => {
    const doc = seedDoc();
    const it = doc.days.flatMap((d) => d.items).find((i) => i.lat != null)!;
    await putLookup("commons-photos", it.id, { name: it.name, lat: it.lat, lng: it.lng, photos: parseCommons(commonsBody) }, "test", null);
    signedOut();
    expect((await H.getPhotos(req("GET", `/api/photos?item=${it.id}`))).status).toBe(401);
    const viaToken = await H.getPhotos(req("GET", `/api/photos?item=${it.id}&token=${token}`));
    expect(((await viaToken.json()) as { commons: unknown[] }).commons).toHaveLength(2);
    asOwner();
    expect(((await (await H.getPhotos(req("GET", `/api/photos?item=${it.id}`))).json()) as { commons: unknown[] }).commons).toHaveLength(2);
  });

  it("/api/media serves Kai's photos only to the owner or a share token, and only from web/media", async () => {
    const path = (p: string) => ({ params: Promise.resolve({ path: p.split("/") }) });
    signedOut();
    expect((await H.getMedia(req("GET", "/api/media/balloon-aloft/06-redballoon-sunrise.webp"), path("balloon-aloft/06-redballoon-sunrise.webp"))).status).toBe(401);
    const ok = await H.getMedia(req("GET", `/api/media/balloon-aloft/06-redballoon-sunrise.webp?token=${token}`), path("balloon-aloft/06-redballoon-sunrise.webp"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    asOwner();
    expect((await H.getMedia(req("GET", "/api/media/x"), path("../package.json"))).status).toBe(404);
  });
});
