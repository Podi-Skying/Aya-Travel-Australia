import { beforeEach, describe, expect, it } from "vitest";
import { seedDoc, freshDb } from "./helpers";
import { applyOp } from "@/domain/ops";
import { parseTripDoc, type TripDoc, type TripOption } from "@/domain/schema";
import { optionCard, dayNightLabel } from "@/domain/options";
import { toPublicDoc } from "@/domain/privacy";
import { getLegs } from "@/server/routes";
import { cached, getLookup, putLookup } from "@/server/cache";
import { parseKp } from "@/server/sky";

/* PLAN-2026-10-26: trip options, sky watch, route and lookup caches. */

const allIds = (doc: TripDoc) => [...doc.days.flatMap((d) => d.items.map((i) => i.id)), ...doc.attractionPool.flatMap((p) => p.items.map((i) => i.id))].sort();
const dayIds = (doc: TripDoc, date: string) => doc.days.find((d) => d.date === date)!.items.map((i) => i.id).sort();

function withOptions() {
  const doc = seedDoc() as TripDoc;
  const a: TripOption = {
    key: "nw-a", group: "nw", title: "方案 A", summary: "", region: "西北海岸", themes: ["hike"], chosen: false, start: "2026-11-16",
    days: [
      { title: "A1", stay: "cradle", driveHrs: 4, itemIds: ["a49", "a50"] },
      { title: "A2", stay: "cradle", driveHrs: 1, itemIds: ["a51", "a52"] },
      { title: "A3", stay: "utas", driveHrs: 4, itemIds: ["a53"] },
    ],
  };
  const b: TripOption = {
    key: "nw-b", group: "nw", title: "方案 B", summary: "", region: "西北海岸", themes: [], chosen: false, start: "2026-11-16",
    days: [
      { title: "B1", stay: "cradle", driveHrs: 5, itemIds: ["a10", "a38"] },
      { title: "B2", stay: "utas", driveHrs: 0, itemIds: [] },
    ],
  };
  const r = parseTripDoc({ ...doc, tripOptions: [a, b] });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.doc;
}

describe("trip options", () => {
  it("rejects unknown item ids, dates outside the trip and two chosen options in a group", () => {
    const doc = withOptions();
    const bad = (patch: (o: TripOption[]) => void) => {
      const opts = structuredClone(doc.tripOptions);
      patch(opts);
      return parseTripDoc({ ...doc, tripOptions: opts }).ok;
    };
    expect(bad((o) => o[0].days[0].itemIds.push("nope"))).toBe(false);
    expect(bad((o) => (o[0].start = "2026-11-26"))).toBe(false);
    expect(bad((o) => o.forEach((x) => (x.chosen = true)))).toBe(false);
    expect(bad(() => {})).toBe(true);
  });

  it("applies B then A without losing or duplicating activities, and marks the chosen one", () => {
    const doc = withOptions();
    const before = allIds(doc);
    const rb = applyOp(doc, { op: "applyOption", key: "nw-b" });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(parseTripDoc(rb.doc).ok).toBe(true);
    expect(allIds(rb.doc)).toEqual(before);
    expect(dayIds(rb.doc, "2026-11-16")).toEqual(["a10", "a38"]);
    expect(dayIds(rb.doc, "2026-11-17")).toEqual([]);
    expect(dayIds(rb.doc, "2026-11-09")).not.toContain("a38"); // moved from its day
    expect(rb.doc.days.find((d) => d.date === "2026-11-16")!).toMatchObject({ title: "B1", driveHrs: 5 });
    expect(rb.doc.tripOptions.map((o) => o.chosen)).toEqual([false, true]);
    const ra = applyOp(rb.doc, { op: "applyOption", key: "nw-a" });
    expect(ra.ok).toBe(true);
    if (!ra.ok) return;
    expect(parseTripDoc(ra.doc).ok).toBe(true);
    expect(allIds(ra.doc)).toEqual(before);
    expect(dayIds(ra.doc, "2026-11-16")).toEqual(["a49", "a50"]);
    expect(dayIds(ra.doc, "2026-11-17")).toEqual(["a51", "a52"]);
    expect(ra.doc.tripOptions.map((o) => o.chosen)).toEqual([true, false]);
  });

  it("keeps confirmed bookings on the option dates and refuses to move a confirmed activity", () => {
    let doc = withOptions();
    const s = applyOp(doc, { op: "setStatus", date: "2026-11-17", itemId: "a51", status: "confirmed" });
    if (!s.ok) throw new Error(s.error);
    doc = s.doc;
    const rb = applyOp(doc, { op: "applyOption", key: "nw-b" });
    expect(rb.ok && dayIds(rb.doc, "2026-11-17")).toEqual(["a51"]);
    const c = applyOp(withOptions(), { op: "setStatus", date: "2026-11-09", itemId: "a38", status: "confirmed" });
    if (!c.ok) throw new Error(c.error);
    expect(applyOp(c.doc, { op: "applyOption", key: "nw-b" }).ok).toBe(false);
  });

  it("removing an activity drops it from options", () => {
    const r = applyOp(withOptions(), { op: "removeItem", date: "2026-11-16", itemId: "a49" });
    expect(r.ok && r.doc.tripOptions[0].days[0].itemIds).toEqual(["a50"]);
    expect(r.ok && parseTripDoc(r.doc).ok).toBe(true);
  });

  it("derives card numbers from the same budget rules", () => {
    const doc = withOptions();
    const a = optionCard(doc, doc.tripOptions[0], 2);
    expect(a.nights).toBe(2);
    expect(dayNightLabel(a)).toBe("3天2夜");
    expect(a.driveHrs).toBe(9);
    expect(a.route).toBe("A1 → A2 → A3");
    expect(a.stays).toEqual([{ key: "cradle", name: doc.stays.cradle.name, nightly: doc.stays.cradle.nightly, nights: 2 }]);
    expect(a.cost).toBeGreaterThan(0);
    const b = optionCard(doc, doc.tripOptions[1], 2);
    expect(dayNightLabel(b)).toBe("1天1夜");
  });
});

describe("sky watch", () => {
  it("adds and removes links and posts, validates URLs, and shows the post photo to guests too", () => {
    let doc = seedDoc() as TripDoc;
    expect(applyOp(doc, { op: "addSkyLink", kind: "aurora", label: "x", url: "http://a.b", newId: "l1" }).ok).toBe(false);
    const r1 = applyOp(doc, { op: "addSkyLink", kind: "aurora", label: "極光社團", url: "https://www.facebook.com/groups/x", newId: "l1" });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyOp(r1.doc, { op: "addSkyPost", kind: "bio", text: "Zayden 說今晚有藍眼淚", date: "2026-11-08", photoUrl: "https://e.x/p.jpg", newId: "p1" });
    if (!r2.ok) throw new Error(r2.error);
    doc = r2.doc;
    expect(parseTripDoc(doc).ok).toBe(true);
    const pub = JSON.stringify(toPublicDoc(doc));
    expect(pub).toContain("極光社團");
    expect(pub).not.toContain("Zayden");
    expect(pub).toContain("p.jpg"); // photos are public (Kai 2026-10-27)
    expect(JSON.stringify(toPublicDoc(doc, { photos: true }))).toContain("p.jpg");
    const r3 = applyOp(doc, { op: "removeSkyPost", id: "p1" });
    expect(r3.ok && r3.doc.skyWatch.posts).toEqual([]);
  });

  it("parses both NOAA Kp shapes and rejects junk", () => {
    expect(parseKp([{ time_tag: "2026-10-26T00:00:00", kp: 5.33, observed: "predicted" }])).toEqual([{ time: "2026-10-26T00:00Z", kp: 5.33, kind: "predicted" }]);
    expect(parseKp([["time_tag", "kp", "observed"], ["2026-10-26 03:00:00", "2.67", "observed"]])).toEqual([{ time: "2026-10-26T03:00Z", kp: 2.67, kind: "observed" }]);
    expect(() => parseKp({})).toThrow();
    expect(() => parseKp([["a", "b"]])).toThrow();
  });
});

describe("caches", () => {
  beforeEach(async () => {
    await freshDb();
  });

  const osrmBody = (n: number) => ({
    code: "Ok",
    routes: [{ legs: Array.from({ length: n }, (_, i) => ({ distance: 1000 * (i + 1), duration: 60 * (i + 1), steps: [{ geometry: { coordinates: [[147, -42], [147.1, -42.1]] } }] })) }],
  });

  it("computes missing legs once, then serves them from route_cache; guests never compute", async () => {
    const calls: string[] = [];
    const f = async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => osrmBody(2) };
    };
    const pts: [number, number][] = [[-42.88, 147.33], [-42.5, 147.9], [-42.12, 148.05]];
    const guest = await getLegs(pts, { compute: false, fetch: f });
    expect(guest.legs).toEqual([null, null]);
    expect(calls).toHaveLength(0);
    const first = await getLegs(pts, { compute: true, fetch: f });
    expect(first.computed).toBe(2);
    expect(first.legs.map((l) => l?.durationS)).toEqual([60, 120]);
    expect(first.legs[0]?.geometry).toEqual([[-42, 147], [-42.1, 147.1]]);
    const again = await getLegs(pts, { compute: true, fetch: f });
    expect(again.computed).toBe(0);
    expect(calls).toHaveLength(1);
    expect((await getLegs(pts, { compute: false, fetch: f })).legs.map((l) => l?.distanceM)).toEqual([1000, 2000]);
    await getLegs(pts, { compute: true, refresh: true, fetch: f });
    expect(calls).toHaveLength(2);
  });

  it("treats two stops at one place as a zero leg without calling OSRM", async () => {
    let n = 0;
    const r = await getLegs([[-42.88, 147.33], [-42.88, 147.33]], { compute: true, fetch: async () => (n++, { ok: true, json: async () => ({}) }) });
    expect(r.legs[0]).toMatchObject({ distanceM: 0, durationS: 0 });
    expect(n).toBe(0);
  });

  it("lookup cache honours the TTL and falls back to stale values when loading fails", async () => {
    let loads = 0;
    const load = async () => ++loads;
    expect((await cached("t", "k", 60_000, "s", load))?.value).toBe(1);
    expect((await cached("t", "k", 60_000, "s", load))?.value).toBe(1);
    await putLookup("t", "k", 7, "s", 1, new Date(Date.now() - 10_000)); // expired
    expect((await cached("t", "k", 60_000, "s", load))?.value).toBe(2);
    await putLookup("t", "k", 9, "s", 1, new Date(Date.now() - 10_000));
    const r = await cached("t", "k", 60_000, "s", async () => {
      throw new Error("down");
    });
    expect(r).toMatchObject({ value: 9, stale: true });
    await putLookup("note", "x", { a: 1 }, "manual", null);
    expect((await getLookup("note", "x"))?.fresh).toBe(true);
  });
});

describe("night sky", () => {
  it("gives dusk, dawn, moon and dark hours for a Hobart November night", async () => {
    const { nightSky, kpChance } = await import("@/domain/sky");
    const n = nightSky("2026-11-10");
    expect(n.dusk).toMatch(/^2[1-3]:\d\d$/);
    expect(n.dawn).toMatch(/^0[3-5]:\d\d$/);
    expect(n.moonPct).toBeGreaterThanOrEqual(0);
    expect(n.moonPct).toBeLessThanOrEqual(100);
    expect(n.darkHrs).toBeGreaterThanOrEqual(0);
    expect(n.darkHrs).toBeLessThanOrEqual(8);
    expect(kpChance(6.3).t).toBe("機會高");
    expect(kpChance(4).t).toBe("低");
  });
});

describe("night Kp", () => {
  it("uses only forecast slots that overlap the dark hours", async () => {
    const { nightKp } = await import("@/domain/sky");
    const night = { duskAt: "2026-11-10T10:30:00.000Z", dawnAt: "2026-11-10T17:30:00.000Z" };
    const slots = [
      { time: "2026-11-10T03:00Z", kp: 7 }, // daytime peak in Hobart
      { time: "2026-11-10T09:00Z", kp: 4 },
      { time: "2026-11-10T15:00Z", kp: 5.3 },
      { time: "2026-11-10T18:00Z", kp: 6 }, // after dawn
    ];
    expect(nightKp(night, slots)).toEqual({ time: "2026-11-10T15:00Z", kp: 5.3 });
    expect(nightKp({ duskAt: null, dawnAt: null }, slots)).toBeNull();
  });
});

describe("option days replace day metadata", () => {
  it("resets costs and flags and drops the driver on a rest day", async () => {
    const { applyOp } = await import("@/domain/ops");
    const { parseTripDoc } = await import("@/domain/schema");
    const { seedDoc } = await import("./helpers");
    const base = seedDoc();
    const d = base.days.find((x) => x.date === "2026-11-18")!;
    d.costs = [{ cat: "transport", amount: 75, unit: "group", status: "estimate", label: "old" }];
    d.transfer = true;
    d.alt = "old alt";
    const drv = Object.keys(base.drivers)[0];
    d.needsDriver = drv;
    const r0 = parseTripDoc({
      ...base,
      tripOptions: [{ key: "rest", group: "g", title: "休息", summary: "", region: "", themes: [], chosen: false, start: "2026-11-18", days: [{ title: "休息日", stay: "utas", driveHrs: 0, noDriver: true, itemIds: [] }] }],
    });
    if (!r0.ok) throw new Error(JSON.stringify(r0.errors));
    const r = applyOp(r0.doc, { op: "applyOption", key: "rest" });
    if (!r.ok) throw new Error(r.error);
    const day = r.doc.days.find((x) => x.date === "2026-11-18")!;
    expect(day.costs).toBeUndefined();
    expect(day.transfer).toBeUndefined();
    expect(day.alt).toBeUndefined();
    expect(day.needsDriver).toBeUndefined();
    expect(day.title).toBe("休息日");
  });
});

describe("round-3 fixes", () => {
  it("breaks routes at an activity without coordinates", async () => {
    const { stopsOf } = await import("@/components/useLegs");
    const s = stopsOf([
      { lat: -42.8, lng: 147.3, mode: "drive" },
      { mode: "drive" },
      { lat: -42.5, lng: 147.9, mode: "drive" },
      { lat: -42.4, lng: 148.0, mode: "drive" },
      { lat: -42.3, lng: 148.1, mode: "bus" },
    ]);
    expect(s.map((x) => x.drive)).toEqual([true, false, true, false]);
    // A stop excluded from the map (other region) also breaks the route.
    const t = stopsOf(
      [
        { lat: -42.8, lng: 147.3, mode: "drive" },
        { lat: -33.8, lng: 151.2, mode: "drive" },
        { lat: -42.5, lng: 147.9, mode: "drive" },
      ],
      (i) => i.lat < -40,
    );
    expect(t.map((x) => x.drive)).toEqual([true, false]);
  });

  it("a noDriver option day refuses activities that need a driver", async () => {
    const { applyOp } = await import("@/domain/ops");
    const { parseTripDoc } = await import("@/domain/schema");
    const { effectiveDay } = await import("@/domain/effective-day");
    const base = seedDoc() as TripDoc;
    const pkg = base.attractionPool.find((p) => p.needsDriver)!;
    const id = pkg.items[0].id;
    const r0 = parseTripDoc({
      ...base,
      tripOptions: [{ key: "rest", group: "g", title: "x", summary: "", region: "", themes: [], chosen: false, start: "2026-11-20", days: [{ title: "休息", stay: "utas", driveHrs: 0, noDriver: true, itemIds: [id] }] }],
    });
    if (!r0.ok) throw new Error(JSON.stringify(r0.errors));
    // Driver metadata is never erased; a rest day with a driver activity is refused instead.
    const r = applyOp(r0.doc, { op: "applyOption", key: "rest" });
    expect(r.ok).toBe(false);
    void effectiveDay;
  });

  it("returns validation errors (not a crash) for a malformed option start", async () => {
    const { parseTripDoc } = await import("@/domain/schema");
    const base = seedDoc() as TripDoc;
    const r = parseTripDoc({ ...base, tripOptions: [{ key: "o", group: "g", title: "x", summary: "", region: "", themes: [], chosen: false, start: "not-a-date", days: [{ title: "a", stay: "utas", driveHrs: 0, itemIds: [] }] }] });
    expect(r.ok).toBe(false);
  });

  it("rejects options whose dates are not all trip days or that move items across regions", async () => {
    const { parseTripDoc } = await import("@/domain/schema");
    const base = seedDoc() as TripDoc;
    const sydItem = base.days.find((d) => d.seg === "syd" && d.items.length)!.items[0].id;
    const opt = (start: string, itemIds: string[]) => ({ key: "o", group: "g", title: "x", summary: "", region: "", themes: [], chosen: false, start, days: [{ title: "a", stay: "utas", driveHrs: 0, itemIds }, { title: "b", stay: "utas", driveHrs: 0, itemIds: [] }] });
    expect(parseTripDoc({ ...base, tripOptions: [opt("2026-11-27", [])] }).ok).toBe(false);
    expect(parseTripDoc({ ...base, tripOptions: [opt("2026-11-12", [sydItem])] }).ok).toBe(false);
    expect(parseTripDoc({ ...base, tripOptions: [opt("2026-11-12", [])] }).ok).toBe(true);
  });
});

describe("plan reel palettes", () => {
  it("map plans to regional colours and keep AA contrast for white-on-deep and ink-on-tint", async () => {
    const { PALETTES, INK_PALETTE, optionPalette, contrast } = await import("@/domain/options");
    expect(optionPalette({ title: "搖籃山＋Stanley＋Penguin 三天兩夜", region: "西北海岸" }).name).toBe("moss");
    expect(optionPalette({ title: "只去 Stanley＋Penguin 兩天一夜", region: "西北海岸" }).name).toBe("sand");
    expect(optionPalette({ title: "東海岸三天兩夜", region: "東海岸" }).name).toBe("sea");
    expect(optionPalette({ title: "x", region: "" }).name).toBe("ink");
    for (const p of [...PALETTES, INK_PALETTE]) {
      expect(contrast(p.deep, "#ffffff"), p.name).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#292823", p.tint), p.name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
