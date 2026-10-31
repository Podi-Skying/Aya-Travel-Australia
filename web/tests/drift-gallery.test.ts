import { describe, expect, it } from "vitest";
import { lockAxis, planeShot, releaseVelocity, sameImage, tripShots } from "@/components/DriftGallery";
import type { Item, Photo } from "@/domain/schema";

/* 畫廊 photo list (2026-10-26) */

const ph = (url: string, kind: Photo["kind"] = "custom"): Photo => ({ url, page: "https://example.org", site: "S", kind });
const mk = (id: string, name: string, photo?: Photo, gallery: Photo[] = []) => ({ id, name, time: "09:00", mode: "walk", photo, gallery }) as unknown as Item;

describe("drift gallery", () => {
  it("lists each photo once, skips logistics and stay notes, and keeps the day for scheduled places", () => {
    const days = [{ date: "2026-11-09", items: [mk("a", "Wineglass Bay", ph("/x.webp"), [ph("/y.webp")]), mk("b", "搭 T8 到飯店", ph("/t.webp")), mk("c", "住宿：Bicheno", ph("/s.webp"))] }];
    const pool = [{ items: [mk("d", "Bruny", ph("/x.webp"))] }];
    const commons = { a: [ph("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/1920px-F.jpg", "commons")] };
    const shots = tripShots(days, pool, commons);
    expect(shots.map((s) => s.src)).toEqual(["/x.webp", "/y.webp", "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/500px-F.jpg"]);
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

describe("gallery release speed", () => {
  it("uses the last 100 ms, stops when the finger had paused, and caps a flick", () => {
    const samples = [{ t: 0, pos: 0 }, { t: 50, pos: 25 }, { t: 100, pos: 50 }];
    expect(releaseVelocity(samples, 110)).toBe(500);
    expect(releaseVelocity(samples, 300)).toBe(0);
    expect(releaseVelocity([{ t: 0, pos: 0 }, { t: 8, pos: 400 }], 10)).toBe(3000);
    expect(releaseVelocity([], 0)).toBe(0);
  });
});

describe("gallery gestures and photos", () => {
  it("locks one axis only after 10 px", () => {
    expect(lockAxis(5, -6)).toBeNull();
    expect(lockAxis(14, 3)).toBe("x");
    expect(lockAxis(-9, 12)).toBe("y");
  });

  it("keeps a plane's photo when the list changes, and picks a new one only when it recycles", () => {
    const first = planeShot(undefined, 3, ["a", "b", "c", "d"]);
    expect(first.shot).toBe("d");
    expect(planeShot(first, 3, ["new", "a", "b", "c", "d"]).shot).toBe("d");
    expect(planeShot(first, 4, ["a", "b", "c", "d"]).shot).toBe("a");
    expect(planeShot(undefined, -1, ["a", "b", "c", "d"]).shot).toBe("d");
  });
});
