import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, seedDoc } from "./helpers";
import { declutter, hobartCivil, inTasmania, kpWindow, parseTasForecast, risks, secondsToHobartMidnight, skyScore, TAS_POINTS, tripPoint } from "@/domain/tas-weather";
import { km } from "@/domain/quiz";
import { toPublicDoc } from "@/domain/privacy";
import type { TripDoc } from "@/domain/schema";
import { getLookup, putLookup } from "@/server/cache";
import { getDb, schema } from "@/server/db/client";
import { LOCK_KIND, tasWeather } from "@/server/tas-weather";

/* 天氣 tab (docs/PLAN-2026-11-08-weather.md). */

/** One Open-Meteo location: `days` local days from `startLocal` (Unix of local midnight), hourly instants every hour. */
function loc(startUnix: number, days: number, offset: number, cloud: (unix: number) => [number, number] = () => [40, 10]) {
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
  const hourly = { time: [] as number[], cloud_cover: [] as number[], cloud_cover_low: [] as number[] };
  for (let h = 0; h < days * 24; h++) {
    const u = startUnix + h * 3600;
    const [c, l] = cloud(u);
    hourly.time.push(u);
    hourly.cloud_cover.push(c);
    hourly.cloud_cover_low.push(l);
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
    expect(await getLookup(LOCK_KIND, "v1")).toBeNull();
  });

  it("serves the previous value without fetching while another instance holds the lease", async () => {
    const f = ok();
    const old = new Date(clock().getTime() - 2 * 3600_000);
    await putLookup("tas-weather", "v1", { hobart: [{ date: "2026-11-09" }] }, "test", 3600_000, old);
    await putLookup(LOCK_KIND, "v1", { token: "0b5d6c1e-1111-4222-8333-944455556666" }, "lease", 60_000, clock());
    const r = await tasWeather(f, clock);
    expect(f).not.toHaveBeenCalled();
    expect(r?.stale).toBe(true);
    expect(r?.fetchedAt.getTime()).toBe(old.getTime());
  });

  it("takes over a lease that this code did not write", async () => {
    for (const [value, ttl] of [[{ token: "0b5d6c1e-1111-4222-8333-944455556666" }, 86_400_000], [{ token: 42 }, 60_000]] as const) {
      await freshDb();
      const f = ok();
      await putLookup(LOCK_KIND, "v1", value, "cli", ttl, clock());
      await tasWeather(f, clock);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("takes over a lease row with no expiry, and refreshes a forecast from before Hobart midnight", async () => {
    const f = ok();
    await putLookup(LOCK_KIND, "v1", { token: "hand-written" }, "cli", null);
    // Fetched 10 minutes ago, but it starts yesterday (8 Nov): not fresh on 9 Nov.
    await putLookup("tas-weather", "v1", { hobart: [{ date: "2026-11-08" }] }, "test", 3600_000, new Date(clock().getTime() - 600_000));
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
    await putLookup(LOCK_KIND, "v1", { token: "newer" }, "lease", 60_000, clock());
    await putLookup("tas-weather", "v1", { hobart: [{ date: "2026-11-09", marker: "newer" }] }, "test", 3600_000, clock());
    release();
    await p;
    const stored = await getLookup<{ hobart: { marker?: string }[] }>("tas-weather", "v1");
    expect(stored?.value.hobart[0].marker).toBe("newer");
  });

  it("serves the stale value when Open-Meteo fails", async () => {
    const old = new Date(clock().getTime() - 2 * 3600_000);
    await putLookup("tas-weather", "v1", { hobart: [{ date: "2026-11-09" }] }, "test", 3600_000, old);
    const r = await tasWeather(vi.fn(async () => ({ ok: false, json: async () => ({}) })), clock);
    expect(r?.stale).toBe(true);
    expect(await getLookup(LOCK_KIND, "v1")).toBeNull();
  });
});

