import { cached } from "./cache";

/*
 * Aurora outlook (PLAN-2026-10-26 §1): NOAA SWPC planetary Kp forecast, public and keyless.
 * Cached in lookup_cache for 3 hours so page views do not refetch it.
 */

export const KP_SOURCE = "NOAA SWPC planetary K-index forecast";
export const KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
const TTL = 3 * 3_600_000;

export type KpRow = { time: string; kp: number; kind: "observed" | "estimated" | "predicted" };

/** Accepts both NOAA shapes: an array of objects, or a header row followed by arrays. */
export function parseKp(body: unknown): KpRow[] {
  if (!Array.isArray(body)) throw new Error("kp shape");
  const rows: KpRow[] = [];
  for (const r of body) {
    let time: unknown, kp: unknown, kind: unknown;
    if (Array.isArray(r)) [time, kp, kind] = r;
    else if (r && typeof r === "object") ({ time_tag: time, kp, observed: kind } = r as Record<string, unknown>);
    const k = typeof kp === "string" ? Number(kp) : kp;
    if (typeof time !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(time.replace(" ", "T")) || typeof k !== "number" || !Number.isFinite(k)) continue;
    rows.push({ time: time.replace(" ", "T").slice(0, 16) + "Z", kp: Math.round(k * 100) / 100, kind: kind === "observed" ? "observed" : kind === "estimated" ? "estimated" : "predicted" });
  }
  if (!rows.length) throw new Error("kp empty");
  return rows;
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export async function getKpOutlook(f: Fetch = fetch as unknown as Fetch) {
  const r = await cached("kp-forecast", "noaa-3day", TTL, KP_SOURCE, async () => {
    const res = await f(KP_URL, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error("kp http");
    return parseKp(await res.json());
  });
  if (!r) return { kp: [] as KpRow[], fetchedAt: null, stale: true, source: KP_SOURCE, url: KP_URL };
  // Only the latest observation and what lies ahead are useful for planning tonight.
  const now = Date.now() - 3 * 3_600_000;
  return { kp: r.value.filter((x) => Date.parse(x.time) >= now), fetchedAt: r.fetchedAt.toISOString(), stale: r.stale, source: KP_SOURCE, url: KP_URL };
}
