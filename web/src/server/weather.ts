import { asc, eq } from "drizzle-orm";
import { cached } from "./cache";
import { getDb, schema } from "./db/client";
import { ownerIds } from "./auth";
import { dayPlace, type DayWx } from "@/domain/weather";
import type { TripDoc } from "@/domain/schema";

/*
 * Trip weather (Kai 2026-10-26): Open-Meteo daily forecasts, public and keyless (best_match uses BOM ACCESS
 * for Australia). One request per place, cached in lookup_cache for 3 hours, so page views never call
 * Open-Meteo directly. Only dates within the 16-day horizon are asked for. Output names places city-level.
 */

export const WX_SOURCE = "Open-Meteo（含 BOM 模型）";
const TTL = 3 * 3_600_000;
const HORIZON_DAYS = 16;
const DAILY = "weather_code,precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,uv_index_max,sunrise,sunset";

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** Open-Meteo daily block → one row per date (dates with no weather code are dropped). */
export function parseDaily(body: unknown): DayWx[] {
  const d = (body as { daily?: Record<string, unknown[]> })?.daily;
  if (!d || !Array.isArray(d.time)) throw new Error("weather shape");
  const out: DayWx[] = [];
  d.time.forEach((t, k) => {
    const code = d.weather_code?.[k];
    if (typeof t !== "string" || !/^\d{4}-\d\d-\d\d$/.test(t) || typeof code !== "number") return;
    out.push({
      date: t,
      code,
      pop: num(d.precipitation_probability_max?.[k]),
      rain: num(d.precipitation_sum?.[k]),
      tMax: num(d.temperature_2m_max?.[k]),
      tMin: num(d.temperature_2m_min?.[k]),
      wind: num(d.wind_speed_10m_max?.[k]),
      uv: num(d.uv_index_max?.[k]),
      sunrise: typeof d.sunrise?.[k] === "string" ? (d.sunrise[k] as string).slice(11, 16) : undefined,
      sunset: typeof d.sunset?.[k] === "string" ? (d.sunset[k] as string).slice(11, 16) : undefined,
    });
  });
  if (!out.length) throw new Error("weather empty");
  return out;
}

export const forecastUrl = (lat: number, lng: number) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&daily=${DAILY}&timezone=auto&forecast_days=${HORIZON_DAYS}&models=best_match`;

async function forecastFor(lat: number, lng: number, f: Fetch) {
  return cached("weather", `${lat.toFixed(2)},${lng.toFixed(2)}`, TTL, WX_SOURCE, async () => {
    const res = await f(forecastUrl(lat, lng), { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) throw new Error("weather http");
    return parseDaily(await res.json());
  });
}

export type TripWeatherDay = { date: string; place: string; wx: DayWx | null; unavailable?: boolean };

/** Today's date in Hobart (the trip's clock), YYYY-MM-DD. */
const hobartDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Hobart" }).format(d);

/** Forecast for every trip day: within the horizon from the cache (or one fetch per place), later days null. */
export async function tripWeather(doc: Pick<TripDoc, "days" | "stays" | "tripOptions">, now = new Date(), f: Fetch = fetch as unknown as Fetch) {
  // Open-Meteo answers in local dates (timezone=auto), so the window is counted in Hobart dates too.
  const today = hobartDate(now);
  const last = new Date(Date.parse(today + "T00:00:00Z") + (HORIZON_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const days = doc.days.map((d) => ({ d, place: dayPlace(doc, d) }));
  const wanted = days.filter(({ d }) => d.date >= today && d.date <= last);
  const places = new Map(wanted.map(({ place }) => [`${place.lat},${place.lng}`, place]));
  const results = new Map<string, Awaited<ReturnType<typeof forecastFor>>>();
  await Promise.all([...places].map(async ([k, p]) => results.set(k, await forecastFor(p.lat, p.lng, f))));
  let fetchedAt: Date | null = null;
  let stale = false;
  const out: TripWeatherDay[] = days.map(({ d, place }) => {
    const r = results.get(`${place.lat},${place.lng}`);
    if (r) {
      if (!fetchedAt || r.fetchedAt < fetchedAt) fetchedAt = r.fetchedAt;
      stale ||= r.stale;
    }
    const inRange = d.date >= today && d.date <= last;
    const wx = r?.value.find((w) => w.date === d.date) ?? null;
    return { date: d.date, place: place.name, wx, ...(inRange && !wx ? { unavailable: true } : {}) };
  });
  return { days: out, source: WX_SOURCE, url: "https://open-meteo.com/", fetchedAt: (fetchedAt as Date | null)?.toISOString() ?? null, stale, horizonEnd: last };
}

/** The owner's current trip document, server-side only (the response carries city names, never positions). */
export async function ownerTripDoc(): Promise<TripDoc | null> {
  const owner = ownerIds()[0];
  if (!owner) return null;
  const db = await getDb();
  const { trips, tripVersions } = schema;
  const r = await db
    .select({ doc: tripVersions.doc })
    .from(trips)
    .innerJoin(tripVersions, eq(tripVersions.id, trips.currentVersionId))
    .where(eq(trips.ownerGithubId, owner))
    .orderBy(asc(trips.createdAt))
    .limit(1);
  return (r[0]?.doc as TripDoc | undefined) ?? null;
}
