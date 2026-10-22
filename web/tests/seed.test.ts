import { describe, expect, it } from "vitest";
import { loadLegacyData } from "../scripts/legacy";
import { buildSeed, TRIP_END, TRIP_START } from "../scripts/seed-2026-11";
import { parseTripDoc } from "@/domain/schema";
import { weekday } from "@/domain/format";

/* AC14 (seed part). */

const legacy = loadLegacyData();
const doc = buildSeed(legacy);
const legacyItems = new Map<string, Record<string, unknown>>(
  legacy.days.flatMap((d: { items: Record<string, unknown>[] }) => d.items.map((i) => [i.id as string, i])),
);

function addDays(s: string, n: number) {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("seed for the new dates (AC14)", () => {
  it("validates against the schema", () => {
    const r = parseTripDoc(doc);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("has 25 contiguous days from 11/03 to 11/27 and nothing earlier", () => {
    expect(doc.days.length).toBe(25);
    doc.days.forEach((d, i) => expect(d.date).toBe(addDays(TRIP_START, i)));
    expect(doc.days.at(-1)!.date).toBe(TRIP_END);
    expect(doc.meta.start).toBe(TRIP_START);
    expect(doc.meta.end).toBe(TRIP_END);
  });

  it("schedules every legacy item from a25 onward exactly once, a02 on 11/06, and drops a01", () => {
    const scheduled = doc.days.flatMap((d) => d.items.map((i) => i.id));
    const expected = [...legacyItems.keys()].filter((id) => Number(id.slice(1)) >= 25);
    expect([...scheduled].sort()).toEqual([...expected, "a02"].sort());
    expect(new Set(scheduled).size).toBe(scheduled.length);
    expect(doc.days.find((d) => d.date === "2026-11-06")!.items.some((i) => i.id === "a02")).toBe(true);
    const all = JSON.stringify(doc);
    expect(all).not.toContain('"a01"');
  });

  it("keeps a03–a24 in the attraction pool with their legacy information", () => {
    const pool = doc.attractionPool.flatMap((p) => p.items);
    const ids = pool.map((i) => i.id).sort();
    const expected = Array.from({ length: 22 }, (_, k) => "a" + String(k + 3).padStart(2, "0")).sort();
    expect(ids).toEqual(expected);
    for (const it of pool) {
      const l = legacyItems.get(it.id)!;
      for (const k of ["name", "en", "lat", "lng", "src", "cost", "note", "pri", "mode", "travel"]) expect((it as Record<string, unknown>)[k], `${it.id}.${k}`).toEqual(l[k]);
    }
    expect(doc.attractionPool.every((p) => p.seg === "tas")).toBe(true);
  });

  it("keeps driver days on their driver's weekdays", () => {
    for (const d of doc.days) if (d.needsDriver) expect(doc.drivers[d.needsDriver].weekdays, d.date).toContain(weekday(d.date));
  });

  it("keeps weekday-only markets on their weekday", () => {
    const dayOf = (id: string) => doc.days.find((d) => d.items.some((i) => i.id === id))!.date;
    expect(weekday(dayOf("a35"))).toBe(6);
    expect(weekday(dayOf("a56"))).toBe(0);
  });

  it("uses UTAS for Tasmania nights except the legacy paid nights, and no stay on 11/27", () => {
    for (const d of doc.days) {
      if (d.date >= "2026-11-06" && d.date <= "2026-11-26") {
        const legacyDay = legacy.days.find((x: { date: string }) => x.date === d.date);
        const legacyStay = d.date === "2026-11-26" ? "utas" : legacyDay?.stay;
        expect(["utas", "coles", "lst", "cradle"], d.date).toContain(d.stay);
        if (d.stay !== "utas") expect(legacyStay, d.date).toBe(d.stay);
      }
    }
    expect(doc.days.at(-1)!.stay).toBe("none");
  });

  it("rewrites the 11/03 arrival flight without origin-specific data", () => {
    const a25 = doc.days[0].items.find((i) => i.id === "a25")!;
    expect(a25.name).toBe("飛抵雪梨");
    expect(a25.travel).toEqual({});
    expect(a25.cost).toMatchObject({ status: "unknown", amount: 0 });
    expect(a25.src?.url).toContain("sydneyairport");
  });
});
