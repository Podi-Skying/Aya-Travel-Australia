import { describe, expect, it } from "vitest";
import { sameImage, tripShots } from "@/components/DriftGallery";
import type { Item, Photo } from "@/domain/schema";

/* 畫廊 photo list (2026-10-26) */

const ph = (url: string, kind: Photo["kind"] = "custom"): Photo => ({ url, page: "https://example.org", site: "S", kind });
const mk = (id: string, name: string, photo?: Photo, gallery: Photo[] = []) => ({ id, name, time: "09:00", mode: "walk", photo, gallery }) as unknown as Item;

describe("drift gallery", () => {
  it("lists each photo once, skips logistics and stay notes, and keeps the day for scheduled places", () => {
    const days = [{ date: "2026-11-09", items: [mk("a", "Wineglass Bay", ph("/x.webp"), [ph("/y.webp")]), mk("b", "搭 T8 到 Riverwood", ph("/t.webp")), mk("c", "住宿：Bicheno", ph("/s.webp"))] }];
    const pool = [{ items: [mk("d", "Bruny", ph("/x.webp"))] }];
    const commons = { a: [ph("https://upload.wikimedia.org/a/b/1920px-F.jpg", "commons")] };
    const shots = tripShots(days, pool, commons);
    expect(shots.map((s) => s.src)).toEqual(["/x.webp", "/y.webp", "https://upload.wikimedia.org/a/b/500px-F.jpg"]);
    expect(shots[0]).toMatchObject({ name: "Wineglass Bay", date: "2026-11-09", dayIndex: 0 });
  });

  it("treats sizes and copies of one image as the same photo", () => {
    const a = "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Ile_des_Phoques.jpg/1920px-Ile_des_Phoques.jpg";
    const b = "https://upload.wikimedia.org/wikipedia/commons/6/64/Ile_des_Phoques.jpg";
    expect(sameImage(a)).toBe(sameImage(b));
    expect(sameImage(b)).not.toBe(sameImage(b.replace("Phoques", "phoques")));
    expect(sameImage("/api/media/x/01.webp?token=abc")).toBe(sameImage("/api/media/x/01.webp"));
    const days = [{ date: "2026-11-09", items: [mk("a", "Seals", ph(a, "commons")), mk("b", "Seals again", ph(b, "commons"))] }];
    expect(tripShots(days, [], {})).toHaveLength(1);
  });
});

