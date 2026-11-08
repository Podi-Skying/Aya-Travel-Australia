import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { getLookup } from "./cache";
import { getKpOutlook } from "./sky";
import { hobartToday, parseTas, TAS_POINTS, type HourDay, type TasDay } from "@/domain/tas-weather";

/*
 * Tasmania-wide forecast (Kai 2026-11-08, docs/PLAN-2026-11-08-weather.md §1). One Open-Meteo request for all
 * thirty points, at most once per expiry for the whole site: a lease row in lookup_cache lets one instance
 * fetch while the others serve the previous value. Visitors never reach Open-Meteo.
 */

export const TAS_WX_SOURCE = "Open-Meteo（CC BY 4.0）";
export const TAS_WX_URL = "https://open-meteo.com/";
const KIND = "tas-weather";
export const HOURLY_KIND = "tas-weather-hourly";
export const LOCK_KIND = "tas-weather-lock";
// v3 adds daylight fields and the per-point hourly rows (written with the summary, in one transaction).
const KEY = "v3";
const hourlyKey = (id: string) => `${KEY}:${id}`;
const TTL = 60 * 60_000;
const LEASE_MS = 60_000;
// After a failed fetch the lease is kept for one forecast period, so no instance (and no hourly request) retries
// before then: success or failure, Open-Meteo sees at most one request an hour (about 24 a day).
export const COOLDOWN_MS = 60 * 60_000;
const FETCH_MS = 10_000;
const COLD_WAIT_MS = 15_000;

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
type Value = Record<string, TasDay[]>;
export type TasWeather = { value: Value; fetchedAt: Date; stale: boolean };

export function tasForecastUrl() {
  const lat = TAS_POINTS.map((p) => p.lat).join(",");
  const lng = TAS_POINTS.map((p) => p.lng).join(",");
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max,sunrise,sunset" +
    "&hourly=weather_code,temperature_2m,apparent_temperature,precipitation_probability,precipitation,cloud_cover,cloud_cover_low,wind_gusts_10m,is_day&timezone=Australia%2FHobart&timeformat=unixtime&forecast_days=16&models=best_match"
  );
}

const { lookupCache } = schema;

/** Fresh = within the hour and starting today in Hobart (a forecast from before midnight is refreshed after it). */
function isFresh(hit: { value: Value; fetchedAt: Date } | null, now: Date) {
  if (!hit) return false;
  const first = hit.value[TAS_POINTS[0].id]?.[0]?.date;
  return now.getTime() - hit.fetchedAt.getTime() < TTL && first === hobartToday(now);
}

async function read(): Promise<{ value: Value; fetchedAt: Date } | null> {
  const hit = await getLookup<Value>(KIND, KEY).catch(() => null);
  return hit ? { value: hit.value, fetchedAt: hit.fetchedAt } : null;
}

/** Takes the lease when it is free, expired or malformed; returns false when another holder has it. */
async function acquire(token: string, now: Date): Promise<boolean> {
  const db = await getDb();
  const row = { kind: LOCK_KIND, key: KEY, value: { token }, source: "lease", fetchedAt: now, expiresAt: new Date(now.getTime() + LEASE_MS) };
  const got = await db
    .insert(lookupCache)
    .values(row)
    .onConflictDoUpdate({
      target: [lookupCache.kind, lookupCache.key],
      set: row,
      // Free, expired, or not a lease this code wrote (no expiry, an expiry beyond one cooldown, a token that is not a UUID).
      setWhere: or(
        isNull(lookupCache.expiresAt),
        lt(lookupCache.expiresAt, now),
        gt(lookupCache.expiresAt, new Date(now.getTime() + COOLDOWN_MS)),
        sql`coalesce(${lookupCache.value}->>'token', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
      ),
    })
    .returning({ kind: lookupCache.kind });
  return got.length > 0;
}

async function release(token: string) {
  const db = await getDb();
  await db
    .delete(lookupCache)
    .where(and(eq(lookupCache.kind, LOCK_KIND), eq(lookupCache.key, KEY), sql`${lookupCache.value}->>'token' = ${token}`))
    .catch(() => {});
}

/** Keeps the lease after a failed fetch, as a shared cooldown: other requests serve the stored forecast meanwhile. */
async function cooldown(token: string, now: Date) {
  const db = await getDb();
  await db
    .update(lookupCache)
    .set({ expiresAt: new Date(now.getTime() + COOLDOWN_MS) })
    .where(and(eq(lookupCache.kind, LOCK_KIND), eq(lookupCache.key, KEY), sql`${lookupCache.value}->>'token' = ${token}`))
    .catch(() => {});
}

/** Writes the forecast only while this token still holds the lease, and frees the lease, in one transaction. */
async function commit(token: string, value: Value, hourly: Record<string, HourDay[]>, now: Date): Promise<boolean> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const held = await tx
      .select({ kind: lookupCache.kind })
      .from(lookupCache)
      .where(and(eq(lookupCache.kind, LOCK_KIND), eq(lookupCache.key, KEY), sql`${lookupCache.value}->>'token' = ${token}`))
      .for("update");
    if (!held.length) return false;
    const expiresAt = new Date(now.getTime() + TTL);
    const row = { kind: KIND, key: KEY, value, source: TAS_WX_SOURCE, fetchedAt: now, expiresAt };
    await tx.insert(lookupCache).values(row).onConflictDoUpdate({ target: [lookupCache.kind, lookupCache.key], set: row });
    // One small row per point: the hourly sheet loads one place, never all thirty.
    const rows = Object.entries(hourly).map(([id, v]) => ({ kind: HOURLY_KIND, key: hourlyKey(id), value: v, source: TAS_WX_SOURCE, fetchedAt: now, expiresAt }));
    if (rows.length)
      await tx
        .insert(lookupCache)
        .values(rows)
        .onConflictDoUpdate({ target: [lookupCache.kind, lookupCache.key], set: { value: sql`excluded.value`, source: sql`excluded.source`, fetchedAt: sql`excluded.fetched_at`, expiresAt: sql`excluded.expires_at` } });
    await tx.delete(lookupCache).where(and(eq(lookupCache.kind, LOCK_KIND), eq(lookupCache.key, KEY)));
    return true;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function refresh(f: Fetch, clock: () => Date): Promise<TasWeather | null> {
  const prev = await read();
  if (isFresh(prev, clock())) return { ...prev!, stale: false };
  const token = crypto.randomUUID();
  if (!(await acquire(token, clock()).catch(() => false))) {
    if (prev) return { ...prev, stale: true };
    // First load anywhere: wait for the holder (its fetch is bounded at 10 s).
    const until = Date.now() + COLD_WAIT_MS;
    while (Date.now() < until) {
      await sleep(500);
      const v = await read();
      if (v) return { ...v, stale: !isFresh(v, clock()) };
    }
    return null;
  }
  // Another holder may have just finished between our read and the lease.
  const again = await read();
  if (isFresh(again, clock())) {
    await release(token);
    return { ...again!, stale: false };
  }
  try {
    const res = await f(tasForecastUrl(), { signal: AbortSignal.timeout(FETCH_MS) });
    if (!res.ok) throw new Error("tas weather http");
    const { days: value, hourly } = parseTas(await res.json());
    const at = clock();
    if (await commit(token, value, hourly, at)) return { value, fetchedAt: at, stale: false };
    // Lease lost while fetching: someone newer owns the row; serve what is stored.
    const cur = await read();
    return cur ? { ...cur, stale: !isFresh(cur, clock()) } : { value, fetchedAt: at, stale: false };
  } catch {
    await cooldown(token, clock());
    return prev ? { ...prev, stale: true } : null;
  }
}

let inFlight: Promise<TasWeather | null> | null = null;

/** The forecast for every point; one refresh in flight per instance. */
export function tasWeather(f: Fetch = fetch as unknown as Fetch, clock: () => Date = () => new Date()): Promise<TasWeather | null> {
  inFlight ??= refresh(f, clock).finally(() => (inFlight = null));
  return inFlight;
}

/**
 * One point's hourly detail (Kai 2026-11-08: rain before dawn should not paint a sunny day). Refreshes the
 * shared forecast first, so the hours always come from the same fetch as the summary. Null: unknown point
 * or no data yet.
 */
export async function tasHourlyResponse(id: string, f?: Fetch, clock: () => Date = () => new Date()) {
  if (!TAS_POINTS.some((p) => p.id === id)) return { notFound: true as const };
  const wx = await tasWeather(f, clock);
  if (!wx) return null;
  // Summary and hours in one statement (one snapshot): another instance's refresh can never mix two fetches here.
  const db = await getDb();
  const rows = await db
    .select()
    .from(lookupCache)
    .where(or(and(eq(lookupCache.kind, KIND), eq(lookupCache.key, KEY)), and(eq(lookupCache.kind, HOURLY_KIND), eq(lookupCache.key, hourlyKey(id)))))
    .catch(() => []);
  const sum = rows.find((r) => r.kind === KIND);
  const hrs = rows.find((r) => r.kind === HOURLY_KIND);
  if (!sum || !hrs || sum.fetchedAt.getTime() !== hrs.fetchedAt.getTime()) return null;
  const today = hobartToday(clock());
  const summary = ((sum.value as Value)[id] ?? []).filter((d) => d.date >= today);
  return { id, days: (hrs.value as HourDay[]).filter((d) => d.date >= today), summary, fetchedAt: hrs.fetchedAt.toISOString(), stale: !isFresh({ value: sum.value as Value, fetchedAt: sum.fetchedAt }, clock()), source: TAS_WX_SOURCE, url: TAS_WX_URL };
}

export async function tasWeatherResponse(f?: Fetch, clock: () => Date = () => new Date()) {
  const [wx, kp] = await Promise.all([tasWeather(f, clock), getKpOutlook().catch(() => null)]);
  if (!wx) return null;
  const today = hobartToday(clock());
  const days = Object.fromEntries(Object.entries(wx.value).map(([id, d]) => [id, d.filter((x) => x.date >= today)]));
  return {
    points: TAS_POINTS,
    days,
    // An outdated Kp (NOAA unreachable) is hidden rather than shown as tonight's outlook.
    kp: kp && !kp.stale ? kp.kp : [],
    fetchedAt: wx.fetchedAt.toISOString(),
    stale: wx.stale,
    source: TAS_WX_SOURCE,
    url: TAS_WX_URL,
  };
}
