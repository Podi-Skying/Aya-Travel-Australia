import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, seedDoc } from "./helpers";
import { declutter, HOURLY_DAYS, mergeNightRain, worstCode, wxSeverity, hobartCivil, parseTas, inTasmania, kpWindow, parseTasForecast, risks, secondsToHobartMidnight, skyScore, TAS_POINTS, tripPoint } from "@/domain/tas-weather";
import { km } from "@/domain/quiz";
import { toPublicDoc } from "@/domain/privacy";
import type { TripDoc } from "@/domain/schema";
import { getLookup, putLookup } from "@/server/cache";
import { getDb, schema } from "@/server/db/client";
import { COOLDOWN_MS, HOURLY_KIND, LOCK_KIND, tasForecastUrl, tasHourlyResponse, tasWeather } from "@/server/tas-weather";

/* 天氣 tab (docs/PLAN-2026-11-08-weather.md). */

/** One Open-Meteo location: `days` local days from `startLocal` (Unix of local midnight), hourly instants every hour. */
type Wx = { code: number; mm: number; pop: number };
function loc(startUnix: number, days: number, offset: number, cloud: (unix: number) => [number, number] = () => [40, 10], wx: (unix: number) => Wx = () => ({ code: 1, mm: 0, pop: 10 })) {
  const daily = { time: [] as number[], weather_code: [] as number[], temperature_2m_max: [] as number[], temperature_2m_min: [] as number[], precipitation_probability_max: [] as number[], precipitation_sum: [] as number[], wind_gusts_10m_max: [] as number[], sunrise: [] as number[], sunset: [] as number[] };
  for (let k = 0; k < days; k++) {
    const t = startUnix + k * 86400;
    daily.time.push(t);
    daily.weather_code.push(k === 0 ? 0 : 61);
    daily.temperature_2m_max.push(18.4);
    daily.temperature_2m_min.push(k === 1 ? 0.6 : 7.2);
    daily.precipitation_probability_max.push(20);
    daily.precipitation_sum.push(0.44);
    daily.wind_gusts_10m_max.push(k === 2 ? 64 : 30);
    daily.sunrise.push(t + 6 * 3600);
    daily.sunset.push(t + 20 * 3600);
  }
  const hourly = { time: [] as number[], cloud_cover: [] as number[], cloud_cover_low: [] as number[], weather_code: [] as number[], temperature_2m: [] as number[], apparent_temperature: [] as number[], precipitation_probability: [] as number[], precipitation: [] as number[], wind_gusts_10m: [] as number[], is_day: [] as number[] };
  for (let h = 0; h < days * 24; h++) {
    const u = startUnix + h * 3600;
    const [c, l] = cloud(u);
    const w = wx(u);
    hourly.time.push(u);
    hourly.cloud_cover.push(c);
    hourly.cloud_cover_low.push(l);
    hourly.weather_code.push(w.code);
    hourly.temperature_2m.push(12.34);
    hourly.apparent_temperature.push(10.06);
    hourly.precipitation_probability.push(w.pop);
    hourly.precipitation.push(w.mm);
    hourly.wind_gusts_10m.push(30);
    hourly.is_day.push((u - startUnix) % 86400 >= 6 * 3600 && (u - startUnix) % 86400 < 20 * 3600 ? 1 : 0);
  }
  return { utc_offset_seconds: offset, daily, hourly };
}

// 2026-11-09 00:00 AEDT (UTC+11) = 2026-11-08T13:00Z.
const NOV9 = Date.UTC(2026, 10, 8, 13) / 1000;

describe("Tasmania forecast parsing", () => {
  it("reads one row per point and date, with day cloud, sun times and the night window across midnight", () => {
    const night = (u: number) => {
      const c = hobartCivil(u);
      return c.hour >= 22 || c.hour < 3 ? ([80, 60] as [number, number]) : ([20, 5] as [number, number]);
    };
    const pts = [{ id: "a" }, { id: "b" }];
    const out = parseTasForecast([loc(NOV9, 3, 39600, night), loc(NOV9, 3, 39600)], pts);
    expect(Object.keys(out)).toEqual(["a", "b"]);
    const d = out.a[0];
    expect(d.date).toBe("2026-11-09");
    expect(d.sunrise).toBe("06:00");
    expect(d.sunset).toBe("20:00");
    expect(d.rain).toBe(0.4);
    expect(d.cloudDay).toBe(20);
    expect([d.nightCloud, d.nightLow]).toEqual([80, 60]);
    // The last date's night runs past the data: no score.
    expect(out.a[2].nightCloud).toBeNull();
    expect(() => parseTasForecast([loc(NOV9, 3, 39600)], pts)).toThrow();
  });

  it("keeps each daily row on its own local date across both DST changes", () => {
    // Spring forward: Sunday 4 Oct 2026, 02:00 AEST → 03:00 AEDT. The data starts 3 Oct 00:00 AEST (UTC+10).
    const oct3 = Date.UTC(2026, 9, 2, 14) / 1000;
    const spring = parseTasForecast([loc(oct3, 4, 36000)], [{ id: "x" }]).x;
    expect(spring.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
    // The night of 3 Oct loses 02:00 (22, 23, 00, 01) and still counts as complete.
    expect(spring[0].nightCloud).toBe(40);
    // Fall back: Sunday 5 Apr 2026, 03:00 AEDT → 02:00 AEST. Data from 4 Apr 00:00 AEDT (UTC+11).
    const apr4 = Date.UTC(2026, 3, 3, 13) / 1000;
    const autumn = parseTasForecast([loc(apr4, 4, 39600)], [{ id: "x" }]).x;
    expect(autumn.map((d) => d.date)).toEqual(["2026-04-04", "2026-04-05", "2026-04-06", "2026-04-07"]);
    expect(autumn[0].nightCloud).toBe(40);
  });

  it("scores the night sky with low cloud weighted most, and flags wind and frost only on real values", () => {
    expect(skyScore(10, 5)).toEqual({ score: 7, band: "clear" });
    expect(skyScore(90, 20)?.band).toBe("some");
    expect(skyScore(90, 90)?.band).toBe("cloudy");
    expect(skyScore(null, 4)).toBeNull();
    expect(risks({ gust: 60, tMin: 1 })).toEqual({ wind: true, frost: true });
    expect(risks({ gust: null, tMin: null })).toEqual({ wind: false, frost: false });
  });

  it("finds the strongest Kp of a Hobart night", () => {
    const rows = [
      { time: "2026-11-09T09:00Z", kp: 3, kind: "predicted" }, // 20:00–23:00 AEDT
      { time: "2026-11-09T12:00Z", kp: 5.33, kind: "predicted" }, // 23:00–02:00
      { time: "2026-11-09T18:00Z", kp: 7, kind: "predicted" }, // 05:00 next morning: outside
      { time: "2026-11-09T15:00Z", kp: 8, kind: "observed" }, // inside, but an observation, not the outlook
    ];
    expect(kpWindow(rows, "2026-11-09")).toEqual({ kp: 5.3, from: "23:00", to: "02:00" });
    expect(kpWindow([], "2026-11-09")).toBeNull();
  });
});

describe("daylight summary and hourly detail", () => {
  // Sunrise 06:00, sunset 20:00 local in the fixture.
  const at = (u: number) => hobartCivil(u).hour;
  // Open-Meteo reports rain for the hour before each sample (rain in the hour starting at h sits on the h + 1
  // sample); the weather code is the value at the sample's own time.
  const rainAt = (hours: number[], code = 61) => (u: number) => {
    const wet = hours.includes((at(u) + 23) % 24);
    return { code: hours.includes(at(u)) ? code : 1, mm: wet ? 0.8 : 0, pop: wet ? 70 : 10 };
  };

  it("keeps a sunny daylight icon when the rain falls only before dawn, and says when", () => {
    const d = parseTasForecast([loc(NOV9, 2, 39600, undefined, rainAt([2, 3, 4]))], [{ id: "x" }]).x[0];
    expect(d.code).toBe(0); // the fixture's daily code
    expect([d.dayCode, d.dayPop, d.dayRain]).toEqual([1, 10, 0]);
    expect(d.nightRain).toEqual(["02–05"]);
  });

  it("drops the hint when it also rains in daylight, and gives two ranges for dawn and evening rain", () => {
    const wet = parseTasForecast([loc(NOV9, 2, 39600, undefined, rainAt([3, 14]))], [{ id: "x" }]).x[0];
    expect([wet.dayCode, wet.dayPop, wet.dayRain, wet.nightRain]).toEqual([61, 70, 0.8, []]);
    const both = parseTasForecast([loc(NOV9, 2, 39600, undefined, rainAt([3, 22, 23]))], [{ id: "x" }]).x[0];
    expect(both.nightRain).toEqual(["03–04", "22–24"]);
    // 05:00–06:00 ends at sunrise, so it is night; fog is never rain.
    const fog = parseTasForecast([loc(NOV9, 2, 39600, undefined, (u) => (at(u) === 5 ? { code: 45, mm: 0, pop: 0 } : { code: 1, mm: 0, pop: 0 }))], [{ id: "x" }]).x[0];
    expect([fog.dayCode, fog.nightRain]).toEqual([1, []]);
  });

  it("merges a region's night-rain ranges into one dawn span and one evening span", () => {
    expect(mergeNightRain(["00–04", "00–05", "01–04"])).toEqual(["00–05"]);
    expect(mergeNightRain(["02–03", "21–24", "22–23"])).toEqual(["02–03", "21–24"]);
    expect(mergeNightRain([])).toEqual([]);
  });

  it("splits rain runs at a dry hour, and ranks codes by severity, not by number", () => {
    const gap = parseTasForecast([loc(NOV9, 2, 39600, undefined, rainAt([2, 4]))], [{ id: "x" }]).x[0];
    expect(gap.nightRain).toEqual(["02–03", "04–05"]);
    // Slight snow showers (85) at 10:00, violent rain showers (82) at 14:00: the day is the rain.
    const mixed = parseTasForecast([loc(NOV9, 2, 39600, undefined, (u) => (at(u) === 10 ? { code: 85, mm: 0, pop: 40 } : at(u) === 14 ? { code: 82, mm: 0, pop: 90 } : { code: 1, mm: 0, pop: 0 }))], [{ id: "x" }]).x[0];
    expect(mixed.dayCode).toBe(82);
    // A code change at 15:00 belongs to the 15:00 hour, not the 14:00 one (codes are instants, rain is the hour before).
    const { hourly } = parseTas([loc(NOV9, 2, 39600, undefined, (u) => (at(u) === 15 ? { code: 61, mm: 0, pop: 0 } : { code: 1, mm: 0, pop: 0 }))], [{ id: "x" }]);
    expect([hourly.x[0].hours[14].code, hourly.x[0].hours[15].code]).toEqual([1, 61]);
    expect([wxSeverity(85) < wxSeverity(82), worstCode([3, 45, 51]), worstCode([95, 65])]).toEqual([true, 51, 95]);
  });

  it("classifies and sums rain before rounding it for display", () => {
    // 0.06 mm in each of 03, 13, 14 and 15: not a wet hour anywhere, and the daylight sum is 0.2 mm, not 0.3.
    const drip = (u: number) => ({ code: 1, mm: [4, 14, 15, 16].includes(at(u)) ? 0.06 : 0, pop: 10 });
    const out = parseTas([loc(NOV9, 2, 39600, undefined, drip)], [{ id: "x" }]);
    const d = out.days.x[0];
    expect([d.dayRain, d.nightRain, d.dayCode]).toEqual([0.2, [], 1]);
    const r3 = out.hourly.x[0].hours[3];
    expect([r3.mm, r3.w]).toEqual([0.1, 0]);
  });

  it("falls back to the daily code only, never to whole-day rain, when there are no daylight hours", () => {
    const l = loc(NOV9, 2, 39600) as { hourly: Record<string, unknown> };
    delete l.hourly.weather_code;
    const d = parseTasForecast([l], [{ id: "x" }]).x[0];
    expect([d.dayCode, d.dayPop, d.dayRain, d.nightRain]).toEqual([0, null, null, []]);
  });

  it("keeps the repeated hour apart when clocks go back (5 Apr 2026)", () => {
    const apr4 = Date.UTC(2026, 3, 3, 13) / 1000;
    const rows = parseTas([loc(apr4, 3, 39600)], [{ id: "x" }]).hourly.x[1].hours;
    expect(rows).toHaveLength(25);
    const twos = rows.filter((r) => r.h === 2);
    expect(twos).toHaveLength(2);
    expect(twos[1].u - twos[0].u).toBe(3600);
  });

  it("keeps hourly rows for the first ten dates only, one row per Hobart hour", () => {
    const { hourly } = parseTas([loc(NOV9, 12, 39600)], [{ id: "x" }]);
    expect(hourly.x).toHaveLength(HOURLY_DAYS);
    const first = hourly.x[0];
    expect([first.date, first.sunrise, first.sunset, first.sr, first.ss]).toEqual(["2026-11-09", "06:00", "20:00", 6, 20]);
    expect(first.hours).toHaveLength(24);
    expect(first.hours[3]).toEqual({ u: NOV9 + 3 * 3600, h: 3, code: 1, t: 12.3, f: 10.1, pop: 10, mm: 0, cl: 40, lo: 10, g: 30, d: 0, w: 0 });
    // Spring forward (4 Oct 2026): 23 hours on that date.
    const oct3 = Date.UTC(2026, 9, 2, 14) / 1000;
    expect(parseTas([loc(oct3, 3, 36000)], [{ id: "x" }]).hourly.x[1].hours).toHaveLength(23);
  });

  it("asks Open-Meteo for the hourly fields in the same single request", () => {
    const u = tasForecastUrl();
    for (const v of ["weather_code", "temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "cloud_cover", "cloud_cover_low", "wind_gusts_10m", "is_day"]) expect(u).toMatch(new RegExp(`hourly=[^&]*\\b${v}\\b`));
    expect(u.split("latitude=")[1].split("&")[0].split(",")).toHaveLength(30);
  });
});

describe("points and map", () => {
  it("has 30 points in 8 regions, and tier-1 points at least 50 km apart", () => {
    expect(TAS_POINTS).toHaveLength(30);
    expect(new Set(TAS_POINTS.map((p) => p.region)).size).toBe(8);
    const t1 = TAS_POINTS.filter((p) => p.tier === 1);
    let min = Infinity;
    for (const a of t1) for (const b of t1) if (a !== b) min = Math.min(min, km([a.lat, a.lng], [b.lat, b.lng]));
    expect(min).toBeGreaterThanOrEqual(50);
  });

  it("declutters in priority order", () => {
    const here = { x: 100, y: 100, prio: 3 };
    const t1 = { x: 110, y: 105, prio: 2 };
    const far = { x: 300, y: 300, prio: 1 };
    const kept = declutter([t1, far, here]);
    expect(kept.has(here) && kept.has(far) && !kept.has(t1)).toBe(true);
  });

  it("knows Tasmania from New Zealand, and when Hobart's date ends", () => {
    expect(inTasmania(-42.88, 147.33)).toBe(true);
    expect(inTasmania(-45, 168.66)).toBe(false);
    // 23:50 AEDT on 9 Nov = 12:50Z.
    expect(secondsToHobartMidnight(new Date(Date.UTC(2026, 10, 9, 12, 50)))).toBe(600);
  });
});

describe("where the trip is", () => {
  const stays = { utas: { name: "Home Base Apartments", home: true }, stanley: { name: "Seaside Villas" } } as unknown as TripDoc["stays"];
  const item = (id: string, name: string, lat?: number, lng?: number) => ({ id, name, lat, lng }) as never;

  it("uses the farthest public stop, never the stay", () => {
    expect(tripPoint({ stays }, { seg: "tas", items: [item("1", "Richmond Bridge", -42.735, 147.44), item("2", "午餐", -42.74, 147.43)] })).toBe("richmond");
    expect(tripPoint({ stays }, { seg: "tas", items: [item("1", "Godfreys Beach", -40.754, 145.295), item("2", "Seaside Villas 入住", -41.9, 146.0)] })).toBe("stanley");
    expect(tripPoint({ stays }, { seg: "tas", items: [item("1", "住宿：Stanley 民宿", -40.76, 145.3)] })).toBe("hobart");
    expect(tripPoint({ stays }, { seg: "tas", items: [item("1", "走回住處休息", -40.76, 145.3)] })).toBe("hobart");
    expect(tripPoint({ stays }, { seg: "tas", items: [item("1", "Queenstown NZ", -45, 168.66)] })).toBe("hobart");
    const short = { ...stays, yha: { name: "YHA" } } as unknown as TripDoc["stays"];
    expect(tripPoint({ stays: short }, { seg: "tas", items: [item("1", "YHA", -41.44, 147.14)] })).toBe("hobart");
  });

  it("tells Sydney days apart, and a Sydney → Hobart day with a Tasmanian stop", () => {
    expect(tripPoint({ stays }, { seg: "syd", items: [item("1", "Opera House", -33.86, 151.21)] })).toBe("syd");
    expect(tripPoint({ stays }, { seg: "syd", items: [item("1", "Opera House", -33.86, 151.21), item("2", "Salamanca", -42.887, 147.331)] })).toBe("hobart");
  });

  it("gives the owner and the public the same answer on every day", () => {
    const doc = seedDoc() as TripDoc;
    const pub = toPublicDoc(doc) as unknown as TripDoc;
    for (const d of doc.days) {
      const p = pub.days.find((x) => x.date === d.date)!;
      expect(tripPoint(pub, p), d.date).toBe(tripPoint(doc, d));
    }
  });
});

describe("one Open-Meteo request per refresh", () => {
  beforeEach(async () => {
    await freshDb();
    vi.useRealTimers();
  });
  const pts = (n: number) => Array.from({ length: n }, () => loc(Date.UTC(2026, 10, 8, 13) / 1000, 3, 39600));
  const clock = () => new Date(Date.UTC(2026, 10, 9, 0)); // 11:00 on 9 Nov in Hobart
  const ok = () => vi.fn(async () => ({ ok: true, json: async () => pts(TAS_POINTS.length) }));

  it("fetches once for concurrent cold requests and then serves the cache", async () => {
    const f = ok();
    const all = await Promise.all(Array.from({ length: 5 }, () => tasWeather(f, clock)));
    expect(f).toHaveBeenCalledTimes(1);
    expect(all.every((r) => r && !r.stale && r.value.hobart[0].date === "2026-11-09")).toBe(true);
    await tasWeather(f, clock);
    expect(f).toHaveBeenCalledTimes(1);
    expect(await getLookup(LOCK_KIND, "v3")).toBeNull();
  });

  it("serves the previous value without fetching while another instance holds the lease", async () => {
    const f = ok();
    const old = new Date(clock().getTime() - 2 * 3600_000);
    await putLookup("tas-weather", "v3", { hobart: [{ date: "2026-11-09" }] }, "test", 3600_000, old);
    await putLookup(LOCK_KIND, "v3", { token: "0b5d6c1e-1111-4222-8333-944455556666" }, "lease", 60_000, clock());
    const r = await tasWeather(f, clock);
    expect(f).not.toHaveBeenCalled();
    expect(r?.stale).toBe(true);
    expect(r?.fetchedAt.getTime()).toBe(old.getTime());
  });

  it("takes over a lease that this code did not write", async () => {
    for (const [value, ttl] of [[{ token: "0b5d6c1e-1111-4222-8333-944455556666" }, 86_400_000], [{ token: 42 }, 60_000]] as const) {
      await freshDb();
      const f = ok();
      await putLookup(LOCK_KIND, "v3", value, "cli", ttl, clock());
      await tasWeather(f, clock);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("takes over a lease row with no expiry, and refreshes a forecast from before Hobart midnight", async () => {
    const f = ok();
    await putLookup(LOCK_KIND, "v3", { token: "hand-written" }, "cli", null);
    // Fetched 10 minutes ago, but it starts yesterday (8 Nov): not fresh on 9 Nov.
    await putLookup("tas-weather", "v3", { hobart: [{ date: "2026-11-08" }] }, "test", 3600_000, new Date(clock().getTime() - 600_000));
    const r = await tasWeather(f, clock);
    expect(f).toHaveBeenCalledTimes(1);
    expect(r?.value.hobart[0].date).toBe("2026-11-09");
  });

  it("a holder whose lease was taken writes nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = vi.fn(async () => {
      await gate;
      return { ok: true, json: async () => pts(TAS_POINTS.length) };
    });
    const p = tasWeather(f, clock);
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    // Someone else takes the lease meanwhile (ours expired) and stores a newer value.
    const db = await getDb();
    await db.delete(schema.lookupCache);
    await putLookup(LOCK_KIND, "v3", { token: "newer" }, "lease", 60_000, clock());
    await putLookup("tas-weather", "v3", { hobart: [{ date: "2026-11-09", marker: "newer" }] }, "test", 3600_000, clock());
    release();
    await p;
    const stored = await getLookup<{ hobart: { marker?: string }[] }>("tas-weather", "v3");
    expect(stored?.value.hobart[0].marker).toBe("newer");
  });

  it("serves the stale value when Open-Meteo fails", async () => {
    const old = new Date(clock().getTime() - 2 * 3600_000);
    await putLookup("tas-weather", "v3", { hobart: [{ date: "2026-11-09" }] }, "test", 3600_000, old);
    const fail = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    const r = await tasWeather(fail, clock);
    expect(r?.stale).toBe(true);
    // The lease stays as a shared cooldown: nobody retries for an hour, then the next request does.
    const lock = await getLookup(LOCK_KIND, "v3");
    expect(lock?.expiresAt?.getTime()).toBe(clock().getTime() + COOLDOWN_MS);
    const good = ok();
    expect((await tasWeather(good, () => new Date(clock().getTime() + 60_000)))?.stale).toBe(true);
    expect((await tasHourlyResponse("hobart", good, () => new Date(clock().getTime() + 120_000))) ?? null).toBeNull();
    expect(good).not.toHaveBeenCalled();
    await tasWeather(good, () => new Date(clock().getTime() + COOLDOWN_MS + 1000));
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("stores one hourly row per point with the summary, and serves one point's hours", async () => {
    const f = ok();
    await tasWeather(f, clock);
    const row = await getLookup<{ date: string }[]>(HOURLY_KIND, "v3:hobart");
    expect(row?.value[0].date).toBe("2026-11-09");
    const db = await getDb();
    expect((await db.select().from(schema.lookupCache)).filter((r) => r.kind === HOURLY_KIND)).toHaveLength(30);
    const r = await tasHourlyResponse("hobart", f, clock);
    expect(r && !("notFound" in r) && r.days.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(r && !("notFound" in r) && r.summary[0].date).toBe("2026-11-09");
    expect(f).toHaveBeenCalledTimes(1);
    expect(await tasHourlyResponse("nowhere", f, clock)).toEqual({ notFound: true });
    // Next day: yesterday's hours are dropped.
    const next = () => new Date(Date.UTC(2026, 10, 9, 13, 30));
    const r2 = await tasHourlyResponse("hobart", vi.fn(async () => ({ ok: false, json: async () => ({}) })), next);
    expect(r2 && !("notFound" in r2) && [r2.days.map((d) => d.date), r2.summary[0].date, r2.stale]).toEqual([["2026-11-10", "2026-11-11"], "2026-11-10", true]);
    // Hours from another fetch than the summary are never served together.
    await putLookup(HOURLY_KIND, "v3:bruny", [{ date: "2026-11-10" }], "test", 3600_000, next());
    expect(await tasHourlyResponse("bruny", vi.fn(async () => ({ ok: false, json: async () => ({}) })), next)).toBeNull();
  });

  it("answers 'no data' rather than inventing hours when nothing is stored", async () => {
    const r = await tasHourlyResponse("hobart", vi.fn(async () => ({ ok: false, json: async () => ({}) })), clock);
    expect(r).toBeNull();
  });
});
