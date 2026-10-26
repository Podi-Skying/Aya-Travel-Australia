import { and, gte, like, sql } from "drizzle-orm";
import { getDb, schema } from "./db/client";

/*
 * Google API usage per Hobart day (docs/PLAN-2026-10-26-google.md): calls (billable requests) and
 * hits (answers served from our cache instead). Costs are estimates from Google's list prices,
 * after each SKU's free monthly calls — source: developers.google.com/maps/billing-and-pricing/pricing,
 * read 2026-10-26.
 */

const { googleUsage } = schema;
/** Per-day reservation counter row used for the atomic cap; excluded from reports. */
const TOTAL = "_total";

export const GOOGLE_APIS = {
  places_search: { sku: "Text Search Essentials (IDs Only)", perThousand: 0, freePerMonth: Infinity },
  place_details: { sku: "Place Details Essentials", perThousand: 5, freePerMonth: 10_000 },
  place_photo: { sku: "Place Details Photos", perThousand: 7, freePerMonth: 1_000 },
  routes: { sku: "Compute Routes Essentials", perThousand: 5, freePerMonth: 10_000 },
} as const;
export type GoogleApi = keyof typeof GOOGLE_APIS;

export const hobartDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Hobart" }).format(d);

export const dailyCap = () => Math.max(0, Number(process.env.GOOGLE_DAILY_CAP ?? 200) || 0);

async function bump(api: GoogleApi, field: "calls" | "hits", now: Date) {
  const db = await getDb();
  const day = hobartDay(now);
  await db
    .insert(googleUsage)
    .values({ day, api, calls: field === "calls" ? 1 : 0, hits: field === "hits" ? 1 : 0 })
    .onConflictDoUpdate({ target: [googleUsage.day, googleUsage.api], set: { [field]: sql`${googleUsage[field]} + 1` } });
}

/**
 * Reserves one billable call under today's cap (Hobart day), atomically: the day's `_total` row is
 * incremented only while below the cap, in one statement. False when capped or the DB fails.
 */
export async function takeGoogleCall(api: GoogleApi, now = new Date()): Promise<boolean> {
  const cap = dailyCap();
  if (cap <= 0) return false;
  try {
    const db = await getDb();
    const day = hobartDay(now);
    const r = await db
      .insert(googleUsage)
      .values({ day, api: TOTAL, calls: 1 })
      .onConflictDoUpdate({ target: [googleUsage.day, googleUsage.api], set: { calls: sql`${googleUsage.calls} + 1` }, setWhere: sql`${googleUsage.calls} < ${cap}` })
      .returning({ calls: googleUsage.calls });
    if (!r.length) return false;
    await bump(api, "calls", now);
    return true;
  } catch {
    return false;
  }
}

/** Counts an answer served from cache (no Google call). Never throws. */
export async function noteGoogleHit(api: GoogleApi, now = new Date()) {
  await bump(api, "hits", now).catch(() => {});
}

export type DayUsage = { date: string; apis: Record<string, { calls: number; hits: number }>; calls: number; hits: number };

export async function usageSince(fromDay: string): Promise<DayUsage[]> {
  const db = await getDb();
  const rows = await db.select().from(googleUsage).where(gte(googleUsage.day, fromDay));
  const by = new Map<string, DayUsage>();
  for (const r of rows) {
    if (r.api === TOTAL) continue;
    const d = by.get(r.day) ?? { date: r.day, apis: {}, calls: 0, hits: 0 };
    d.apis[r.api] = { calls: r.calls, hits: r.hits };
    d.calls += r.calls;
    d.hits += r.hits;
    by.set(r.day, d);
  }
  return [...by.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Estimated USD for a month (YYYY-MM): billable calls beyond each SKU's free monthly calls. */
export async function monthCost(month: string): Promise<{ usd: number; calls: Record<string, number> }> {
  const db = await getDb();
  const rows = await db.select().from(googleUsage).where(and(like(googleUsage.day, `${month}-%`)));
  const calls: Record<string, number> = {};
  for (const r of rows) if (r.api !== TOTAL) calls[r.api] = (calls[r.api] ?? 0) + r.calls;
  let usd = 0;
  for (const [api, n] of Object.entries(calls)) {
    const p = GOOGLE_APIS[api as GoogleApi];
    if (p) usd += (Math.max(0, n - p.freePerMonth) * p.perThousand) / 1000;
  }
  return { usd: Math.round(usd * 100) / 100, calls };
}

/** List-price cost of `n` calls ignoring free usage, for backfill estimates. */
export const listPrice = (api: GoogleApi, n: number) => Math.round(((n * GOOGLE_APIS[api].perThousand) / 1000) * 100) / 100;
