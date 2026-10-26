import { describe, expect, it } from "vitest";
import { seedDoc } from "./helpers";
import { orderStops, quizPlaces, REGIONS, km, minutesFrom, LONG_DRIVE_MIN, overnightNear, splitTwoDays } from "@/domain/quiz";
import { applyOp } from "@/domain/ops";
import { parseTripDoc, type TripDoc } from "@/domain/schema";

/* 旅遊規劃小測驗 (2026-10-26) */

describe("planning quiz", () => {
  it("offers only Tasmanian places with a position, each in its nearest region", () => {
    const places = quizPlaces(seedDoc() as TripDoc);
    expect(places.length).toBeGreaterThan(0);
    for (const p of places) {
      expect(p.item.lat!).toBeLessThan(-40);
      const r = REGIONS.find((x) => x.key === p.region)!;
      expect(r.areas.some((a) => km(a.center, [p.item.lat!, p.item.lng!]) <= a.km)).toBe(true);
      expect(p.item.name.startsWith("住宿：")).toBe(false);
    }
  });

  it("puts kunanyi and MONA under 荷巴特", () => {
    const at = (lat: number, lng: number) => quizPlaces({ days: [], attractionPool: [{ key: "k", seg: "tas", items: [{ id: "x", name: "x", lat, lng }] }] } as unknown as TripDoc)[0]?.region;
    expect(at(-42.8956, 147.2370)).toBe("hobart"); // kunanyi summit
    expect(at(-42.8128, 147.2622)).toBe("hobart"); // MONA
    expect(REGIONS.find((r) => r.key === "hobart")!.name).toBe("荷巴特");
    expect(REGIONS.some((r) => r.key === "kunanyi" || r.key === "mona")).toBe(false);
  });

  it("orders stops nearest-first from home", () => {
    const s = (id: string, lat: number, lng: number) => ({ item: { id, lat, lng } });
    const out = orderStops([-42.88, 147.33], [s("far", -43.1, 147.85), s("near", -42.89, 147.34), s("mid", -42.97, 147.31)]);
    expect(out.map((x) => x.item.id)).toEqual(["near", "mid", "far"]);
  });

  it("adds chosen pool places to a day as pending in one version", () => {
    const doc = seedDoc() as TripDoc;
    const pool = doc.attractionPool.find((p) => p.seg === "tas" && p.items.length >= 2)!;
    const date = doc.days.find((d) => d.seg === "tas")!.date;
    const refs = pool.items.slice(0, 2).map((i) => ({ key: pool.key, itemId: i.id }));
    const r = applyOp(doc, { op: "addQuizPlan", date, refs });
    if (!r.ok) throw new Error(r.error);
    const day = r.doc.days.find((d) => d.date === date)!;
    for (const x of refs) expect(day.items.find((i) => i.id === x.itemId)?.status).toBe("pending");
    expect(parseTripDoc(r.doc).ok).toBe(true);
    expect(applyOp(doc, { op: "addQuizPlan", date, refs: [] }).ok).toBe(false);
  });
});

describe("quiz coverage", () => {
  it("includes MONA itself", () => {
    const doc = seedDoc() as TripDoc;
    const mona = [...doc.days.flatMap((d) => d.items), ...doc.attractionPool.flatMap((p) => p.items)].find((i) => i.id === "a16")!;
    Object.assign(mona, { lat: -42.81254, lng: 147.26146 });
    expect(quizPlaces(doc).some((p) => p.item.id === "a16")).toBe(true);
  });

  it("flags long drives and suggests a night near the farthest stop", () => {
    const home: [number, number] = [-42.8799, 147.3247];
    expect(minutesFrom(home, { lat: -41.596, lng: 145.93 })).toBeGreaterThan(LONG_DRIVE_MIN); // Cradle Mountain
    expect(minutesFrom(home, { lat: -42.8128, lng: 147.2622 })).toBeLessThan(LONG_DRIVE_MIN); // MONA
    const town = overnightNear({ stays: {} } as unknown as TripDoc, [-41.64, 145.95]);
    expect(town).toMatchObject({ name: "搖籃山 Cradle Mountain", needsBooking: true });
    const stays = { cradle: { name: "Cradle Lodge", lat: -41.6, lng: 145.94 }, utas: { name: "UTAS", lat: home[0], lng: home[1], home: true } };
    expect(overnightNear({ stays } as unknown as TripDoc, [-41.64, 145.95])).toMatchObject({ stayKey: "cradle", needsBooking: false });
    const s = (id: string, lat: number, lng: number) => ({ item: { id, lat, lng } });
    const [d1, d2] = splitTwoDays(home, [s("a", -42.0, 147.0), s("far", -41.6, 145.9), s("b", -42.3, 146.6)]);
    expect(d1.map((x) => x.item.id)).toEqual(["a", "far"]);
    expect(d2.map((x) => x.item.id)).toEqual(["b"]);
  });

  it("adds an overnight plan across two consecutive days in one version", () => {
    const doc = seedDoc() as TripDoc;
    const pool = doc.attractionPool.find((p) => p.seg === "tas" && p.items.length >= 2)!;
    const tas = doc.days.filter((d) => d.seg === "tas");
    const op = (k: number) => ({ op: "addQuizPlan" as const, date: tas[k].date, refs: [{ key: pool.key, itemId: pool.items[0].id }], nextRefs: [{ key: pool.key, itemId: pool.items[1].id }] });
    // First pair of days that can take the package (some days depend on a driver).
    const k = tas.findIndex((_, j) => j + 1 < tas.length && applyOp(doc, op(j)).ok);
    expect(k).toBeGreaterThanOrEqual(0);
    const r = applyOp(doc, op(k));
    if (!r.ok) throw new Error(r.error);
    expect(r.doc.days.find((d) => d.date === tas[k].date)!.items.some((i) => i.id === pool.items[0].id)).toBe(true);
    expect(r.doc.days.find((d) => d.date === tas[k + 1].date)!.items.some((i) => i.id === pool.items[1].id)).toBe(true);
    const last = doc.days.at(-1)!.date;
    expect(applyOp(doc, { op: "addQuizPlan", date: last, refs: [], nextRefs: [{ key: pool.key, itemId: pool.items[0].id }] }).ok).toBe(false);
  });
});
