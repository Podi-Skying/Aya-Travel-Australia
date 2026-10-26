import { and, eq, like, lt, or } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { GOOGLE_ROUTE_TTL_MS, googleKey, googleLegs, type GFetch, type TravelMode } from "./google";

/*
 * Road legs between consecutive stops (PLAN-2026-10-26 §2). Every computed leg is stored in
 * route_cache and read from there afterwards; OSRM is called only for missing legs, and only
 * when the caller may compute (the owner). Guests read the cache.
 */

const { routeCache } = schema;

export type Pt = [number, number]; // [lat, lng]
export type Leg = { distanceM: number; durationS: number; geometry: Pt[]; source: string; computedAt: string };

export const MAX_POINTS = 25;
const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
export const roundPt = (p: Pt): Pt => [r5(p[0]), r5(p[1])];
const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

export function validPoints(input: unknown): Pt[] | null {
  if (!Array.isArray(input) || input.length < 2 || input.length > MAX_POINTS) return null;
  const out: Pt[] = [];
  for (const p of input) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [lat, lng] = p;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    out.push(roundPt([lat, lng]));
  }
  return out;
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

type OsrmStep = { geometry?: { coordinates?: [number, number][] } };
type OsrmLeg = { distance: number; duration: number; steps?: OsrmStep[] };

/** One OSRM request for the whole list; returns one leg per consecutive pair. */
async function osrm(points: Pt[], f: Fetch): Promise<Omit<Leg, "computedAt">[]> {
  const url = `${OSRM}${points.map(([lat, lng]) => `${lng},${lat}`).join(";")}?overview=false&steps=true&geometries=geojson`;
  const res = await f(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error("osrm http");
  const body = (await res.json()) as { code?: string; routes?: { legs?: OsrmLeg[] }[] };
  const legs = body.routes?.[0]?.legs;
  if (body.code !== "Ok" || !legs || legs.length !== points.length - 1) throw new Error("osrm body");
  return legs.map((l) => {
    const geometry: Pt[] = [];
    for (const s of l.steps ?? [])
      for (const [lng, lat] of s.geometry?.coordinates ?? []) {
        const p = roundPt([lat, lng]);
        if (!geometry.length || !same(geometry.at(-1)!, p)) geometry.push(p);
      }
    return { distanceM: Math.round(l.distance), durationS: Math.round(l.duration), geometry, source: "osrm-demo" };
  });
}

async function readCached(points: Pt[], mode: string): Promise<(Leg | null)[]> {
  const db = await getDb();
  const pairs = points.slice(1).map((to, i) => [points[i], to] as const);
  const rows = await db
    .select()
    .from(routeCache)
    .where(
      and(
        eq(routeCache.mode, mode),
        or(...pairs.map(([a, b]) => and(eq(routeCache.fromLat, a[0]), eq(routeCache.fromLng, a[1]), eq(routeCache.toLat, b[0]), eq(routeCache.toLng, b[1])))),
      ),
    );
  // Google route data is kept for at most 30 days (Maps Platform terms): older rows are deleted and count as missing.
  const old = new Date(Date.now() - GOOGLE_ROUTE_TTL_MS);
  if (rows.some((r) => r.source.startsWith("google") && r.computedAt < old))
    await db.delete(routeCache).where(and(like(routeCache.source, "google%"), lt(routeCache.computedAt, old))).catch(() => {});
  return pairs.map(([a, b]) => {
    const r = rows.find((x) => x.fromLat === a[0] && x.fromLng === a[1] && x.toLat === b[0] && x.toLng === b[1]);
    if (r && r.source.startsWith("google") && r.computedAt < old) return null;
    return r ? { distanceM: r.distanceM, durationS: r.durationS, geometry: r.geometry as Pt[], source: r.source, computedAt: r.computedAt.toISOString() } : null;
  });
}

/**
 * Legs for consecutive points from route_cache. Only with `compute` (owner action or backfill) are
 * missing legs computed: Google Routes when a key is configured, OSRM otherwise. `upgrade` also
 * recomputes cached non-Google legs once a key exists. Page views never compute.
 */
export async function getLegs(
  raw: Pt[],
  opts: { compute: boolean; refresh?: boolean; upgrade?: boolean; fetch?: Fetch; gfetch?: GFetch; provider?: "google" | "osrm"; mode?: TravelMode } = { compute: false },
): Promise<{ legs: (Leg | null)[]; computed: number; cached?: boolean }> {
  const points = raw.map(roundPt);
  const mode: TravelMode = opts.mode ?? "driving";
  // Consecutive duplicates (two activities at one place) are zero legs, not routing work.
  let legs: (Leg | null)[];
  try {
    legs = await readCached(points, mode);
  } catch {
    legs = points.slice(1).map(() => null); // cache table missing: behave as all-miss
  }
  points.slice(1).forEach((b, i) => {
    if (same(points[i], b)) legs[i] = { distanceM: 0, durationS: 0, geometry: [b], source: "same-place", computedAt: new Date(0).toISOString() };
  });
  const provider = opts.provider ?? (googleKey() ? "google" : "osrm");
  // OSRM's demo server only drives: walking and transit legs need Google.
  if (mode !== "driving" && provider !== "google") return { legs, computed: 0 };
  const redo = (l: Leg | null) => !l || (mode === "driving" && opts.upgrade && provider === "google" && l.source !== "google-routes" && l.source !== "same-place");
  const need = opts.refresh ? points.slice(1).some((b, i) => !same(points[i], b)) : legs.some(redo);
  if (!opts.compute || !need) return { legs, computed: 0 };
  const fresh = provider === "google" ? await googleLegs(points, opts.gfetch, mode) : await osrm(points, opts.fetch ?? (fetch as unknown as Fetch));
  const db = await getDb().catch(() => null);
  const now = new Date();
  let computed = 0;
  let cached = !!db;
  for (let i = 0; i < fresh.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (same(a, b) || (!opts.refresh && !redo(legs[i]))) continue;
    const row = { fromLat: a[0], fromLng: a[1], toLat: b[0], toLng: b[1], mode, ...fresh[i], computedAt: now };
    // A failed write or no database (e.g. before the migration) still returns the computed leg.
    await db
      ?.insert(routeCache)
      .values(row)
      .onConflictDoUpdate({
        target: [routeCache.fromLat, routeCache.fromLng, routeCache.toLat, routeCache.toLng, routeCache.mode],
        // Only missing, expired, upgraded or refreshed legs reach here, so the new result replaces the row.
        set: { distanceM: row.distanceM, durationS: row.durationS, geometry: row.geometry, source: row.source, computedAt: now },
      })
      .catch(() => {
        cached = false;
      });
    legs[i] = { ...fresh[i], computedAt: now.toISOString() };
    computed++;
  }
  return { legs, computed, cached };
}
