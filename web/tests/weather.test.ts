import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, seedDoc } from "./helpers";
import { parseDaily, tripWeather, forecastUrl } from "@/server/weather";
import { backupsFor, dayPlace, HOBART, isIndoor, isWet, outdoorPlans, SYDNEY, weatherNote, wxLabel, type DayWx } from "@/domain/weather";
import { applyOp } from "@/domain/ops";
import { parseTripDoc, type TripDoc } from "@/domain/schema";

/* Weather and rain plans (2026-10-26), with Open-Meteo mocked */

const body = (dates: string[], over: Partial<Record<string, unknown[]>> = {}) => ({
  daily: {
    time: dates,
    weather_code: dates.map(() => 61),
    precipitation_probability_max: dates.map(() => 80),
    precipitation_sum: dates.map(() => 6.2),
    temperature_2m_max: dates.map(() => 17.4),
    temperature_2m_min: dates.map(() => 8.1),
    wind_speed_10m_max: dates.map(() => 30),
    uv_index_max: dates.map(() => 5),
    sunrise: dates.map((d) => `${d}T05:50`),
    sunset: dates.map((d) => `${d}T20:05`),
    ...over,
  },
});

describe("weather", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("parses Open-Meteo daily rows and labels WMO codes", () => {
    const rows = parseDaily(body(["2026-11-03", "bad"]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-11-03", code: 61, pop: 80, rain: 6.2, tMax: 17.4, sunset: "20:05" });
    expect(wxLabel(0).t).toBe("晴");
    expect(wxLabel(95).icon).toBe("storm");
    expect(() => parseDaily({})).toThrow();
    expect(forecastUrl(-42.88, 147.33)).toContain("forecast_days=16");
  });

  it("places days city-level: Sydney, Hobart, or the town of an away night", () => {
    const doc = seedDoc() as TripDoc;
    const syd = doc.days.find((d) => d.seg !== "tas")!;
    expect(dayPlace(doc, syd)).toEqual(SYDNEY);
    const tas = doc.days.find((d) => d.seg === "tas" && !d.items.some((i) => i.lat != null && i.lat < -40 && Math.abs(i.lng! - 147.33) > 0.7))!;
    expect([HOBART.name]).toContain(dayPlace(doc, { ...tas, items: [] }).name);
  });

  it("fetches once per place within 16 days, caches for later calls, and leaves later days without a forecast", async () => {
    const doc = seedDoc() as TripDoc;
    const first = doc.days[0].date;
    const now = new Date(first + "T00:00:00Z");
    const dates = Array.from({ length: 16 }, (_, k) => new Date(now.getTime() + k * 86_400_000).toISOString().slice(0, 10));
    const f = vi.fn(async () => ({ ok: true, json: async () => body(dates) }));
    const a = await tripWeather(doc, now, f);
    const calls = f.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(new Set(a.days.map((d) => d.place)).size);
    expect(a.days[0].wx?.pop).toBe(80);
    const late = a.days.find((d) => d.date > dates.at(-1)!);
    if (late) expect(late.wx).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/UTAS|Elizabeth|-42\.879/);
    await tripWeather(doc, now, f);
    expect(f.mock.calls.length).toBe(calls); // served from lookup_cache
  });

  it("marks wet days and finds nearby indoor backups from the pool", () => {
    expect(isWet({ code: 3, pop: 60 } as DayWx)).toBe(true);
    expect(isWet({ code: 95, pop: 10 } as DayWx)).toBe(true);
    expect(isWet({ code: 1, pop: 20 } as DayWx)).toBe(false);
    expect(isIndoor({ name: "塔斯馬尼亞博物館與美術館 TMAG", cat: "history" })).toBe(true);
    expect(isIndoor({ name: "Wineglass Bay 步道", cat: "nature" })).toBe(false);
    expect(isIndoor({ name: "Wineglass Bay 步道", cat: "nature", indoor: true })).toBe(true);
    expect(weatherNote({ name: "Balloon Aloft 獵人谷日出熱氣球" })).toMatch(/清晨的風/);
    const act = { id: "x", name: "Mount Wellington 步道", lat: -42.89, lng: 147.3 } as never;
    const pool = { attractionPool: [{ key: "r", seg: "tas", items: [{ id: "m", name: "TMAG 博物館", cat: "history", lat: -42.8818, lng: 147.3313 }, { id: "far", name: "QVMAG 博物館", cat: "history", lat: -41.42, lng: 147.14 }] }] } as never;
    expect(backupsFor(pool, act, "tas").map((b) => b.item.id)).toEqual(["m"]);
    expect(outdoorPlans({ items: [{ name: "搭 T8 到 Riverwood" }, { name: "住宿：Bicheno" }, { name: "Bay of Fires 海灘", cat: "beach" }] as never }).map((i) => i.name)).toEqual(["Bay of Fires 海灘"]);
  });

  it("swaps an outdoor plan for a backup, toggles indoor, and trades movable plans between days", () => {
    const doc = seedDoc() as TripDoc;
    const pool = doc.attractionPool.find((p) => p.seg === "tas" && p.items.length)!;
    const day = doc.days.find((d) => d.seg === "tas" && d.items.some((i) => i.status !== "confirmed" && !/^(搭|住宿：)/.test(i.name)))!;
    const out = day.items.find((i) => i.status !== "confirmed" && !/^(搭|住宿：)/.test(i.name))!;
    const r = applyOp(doc, { op: "useBackup", date: day.date, itemId: out.id, key: pool.key, backupId: pool.items[0].id });
    if (!r.ok) throw new Error(r.error);
    const d2 = r.doc.days.find((d) => d.date === day.date)!;
    expect(d2.items.some((i) => i.id === out.id)).toBe(false);
    expect(d2.items.find((i) => i.id === pool.items[0].id)).toMatchObject({ time: out.time, status: "pending" });
    expect(parseTripDoc(r.doc).ok).toBe(true);

    const t = applyOp(doc, { op: "setIndoor", itemId: out.id, indoor: "yes" });
    if (!t.ok) throw new Error(t.error);
    expect(t.doc.days.find((d) => d.date === day.date)!.items.find((i) => i.id === out.id)?.indoor).toBe(true);
    expect(applyOp(doc, { op: "setIndoor", itemId: out.id, indoor: "maybe" as never }).ok).toBe(false);

    const tas = doc.days.filter((d) => d.seg === "tas");
    const pair = tas.flatMap((a) => tas.map((b) => [a, b] as const)).find(([a, b]) => a !== b && applyOp(doc, { op: "swapDays", date: a.date, toDate: b.date }).ok);
    expect(pair).toBeTruthy();
    const [a, b] = pair!;
    const s = applyOp(doc, { op: "swapDays", date: a.date, toDate: b.date });
    if (!s.ok) throw new Error(s.error);
    const locked = a.items.filter((i) => i.status === "confirmed").map((i) => i.id);
    for (const id of locked) expect(s.doc.days.find((d) => d.date === a.date)!.items.some((i) => i.id === id)).toBe(true);
    expect(applyOp(doc, { op: "swapDays", date: doc.days[0].date, toDate: tas[0].date }).ok).toBe(false);
  });

  it("treats any snow as wet, counts the window in Hobart dates, and flags a failed fetch apart from the horizon", async () => {
    expect(isWet({ code: 71, pop: 10 } as DayWx)).toBe(true);
    const doc = seedDoc() as TripDoc;
    const first = doc.days[0].date;
    // 20:00 UTC the day before is already the first trip day in Hobart.
    const now = new Date(Date.parse(first + "T00:00:00Z") - 4 * 3_600_000);
    const fail = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    const r = await tripWeather(doc, now, fail);
    expect(r.days[0]).toMatchObject({ date: first, wx: null, unavailable: true });
    const later = r.days.find((d) => d.date > r.horizonEnd);
    if (later) expect(later.unavailable).toBeUndefined();
    expect(r.horizonEnd).toBe(new Date(Date.parse(first + "T00:00:00Z") + 15 * 86_400_000).toISOString().slice(0, 10));
  });
});

